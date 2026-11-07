"""Bounded raw TCP bridges. TLS keys and TLS termination stay inside the enclave."""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import subprocess
import threading
import time


def relay(left, right):
    with left, right, selectors.DefaultSelector() as selector:
        selector.register(left, selectors.EVENT_READ, right)
        selector.register(right, selectors.EVENT_READ, left)
        deadline = time.monotonic() + 90
        while selector.get_map() and time.monotonic() < deadline:
            events = selector.select(timeout=min(60, max(0, deadline - time.monotonic())))
            if not events:
                return
            for key, _ in events:
                data = key.fileobj.recv(16384)
                if data:
                    key.data.sendall(data)
                else:
                    selector.unregister(key.fileobj)
                    key.data.shutdown(socket.SHUT_WR)


def public_destination(host):
    if not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", host):
        raise ValueError("INVALID_HOST")
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global
                            or ipaddress.ip_address(item[4][0]).is_multicast for item in addresses):
        raise ValueError("PRIVATE_DESTINATION")
    # Connect to the validated address, without a second DNS lookup.
    last = None
    for family, kind, protocol, _, address in addresses:
        upstream = socket.socket(family, kind, protocol)
        upstream.settimeout(10)
        try:
            upstream.connect(address)
            return upstream
        except OSError as error:
            last = error
            upstream.close()
    raise OSError("EGRESS_UNAVAILABLE") from last


def forward(connection, family, address):
    with socket.socket(family, socket.SOCK_STREAM) as upstream:
        upstream.settimeout(60)
        upstream.connect(address)
        relay(connection, upstream)


def egress(connection):
    hostname = bytearray()
    while len(hostname) <= 253:
        byte = connection.recv(1)
        if byte == b"\n":
            with public_destination(hostname.decode("ascii")) as upstream:
                connection.sendall(b"\0")
                upstream.settimeout(60)
                relay(connection, upstream)
            return
        if not byte:
            return
        hostname.extend(byte)
    raise ValueError("INVALID_HOST")


def listen(family, address, handler, slots_count, allowed_cid=None):
    listener = socket.socket(family, socket.SOCK_STREAM)
    if family == socket.AF_INET:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(address)
    listener.listen(slots_count)
    slots = threading.BoundedSemaphore(slots_count)

    def handle(connection):
        try:
            with connection:
                connection.settimeout(60)
                handler(connection)
        except (OSError, ValueError, UnicodeError):
            pass
        finally:
            slots.release()

    def accept():
        while True:
            connection, peer = listener.accept()
            if (allowed_cid is not None and peer[0] != allowed_cid) or not slots.acquire(blocking=False):
                connection.close()
            else:
                threading.Thread(target=handle, args=(connection,), daemon=True).start()
    threading.Thread(target=accept, daemon=True).start()
    return listener


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["parent", "enclave"])
    parser.add_argument("--cid", type=int, default=18)
    parser.add_argument("--region")
    parser.add_argument("--config")
    parser.add_argument("--state")
    parser.add_argument("--common", default="/app/common")
    args = parser.parse_args()
    if args.cid <= 3:
        parser.error("invalid CID")
    if args.mode == "parent" and (not args.config or not args.state or not args.region):
        parser.error("parent needs config, state and region")
    children, listeners = [], []

    def start(name, *arguments):
        children.append(subprocess.Popen(["python3", str(Path(args.common) / name), *arguments]))

    def stop(_signum, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        if args.mode == "parent":
            start("config.py", "parent", "--cid", str(args.cid), "--file", args.config)
            start("storage.py", "--cid", str(args.cid), "--directory", args.state)
            start("kms-relay.py", "parent", "--cid", str(args.cid), "--region", args.region)
            listeners += [
                listen(socket.AF_INET, ("0.0.0.0", 443),
                       lambda conn: forward(conn, socket.AF_VSOCK, (args.cid, 9000)), 16),
                listen(socket.AF_INET, ("127.0.0.1", 9081),
                       lambda conn: forward(conn, socket.AF_VSOCK, (args.cid, 9002)), 4),
                listen(socket.AF_VSOCK, (socket.VMADDR_CID_ANY, 9001), egress, 24, args.cid),
            ]
        else:
            start("config.py", "enclave")
            start("storage-relay.py")
            start("kms-relay.py", "enclave")
            listeners += [
                listen(socket.AF_UNIX, "\0cloakroom-egress",
                       lambda conn: forward(conn, socket.AF_VSOCK, (3, 9001)), 24),
                listen(socket.AF_VSOCK, (socket.VMADDR_CID_ANY, 9000),
                       lambda conn: forward(conn, socket.AF_UNIX, "\0cloakroom-rpc"), 16, 3),
                listen(socket.AF_VSOCK, (socket.VMADDR_CID_ANY, 9002),
                       lambda conn: forward(conn, socket.AF_UNIX, "\0cloakroom-rpc-control"), 4, 3),
            ]
            deadline = time.monotonic() + 5
            for name in ("config", "storage", "kms"):
                while True:
                    try:
                        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                            probe.connect("\0cloakroom-" + name)
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError("LOCAL_BRIDGE_UNAVAILABLE") from None
                        time.sleep(0.02)
            children.append(subprocess.Popen(["node", "/app/dist/main.js"]))
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        raise SystemExit(1)
    finally:
        for listener in listeners:
            listener.close()
        for child in children:
            child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()


if __name__ == "__main__":
    main()
