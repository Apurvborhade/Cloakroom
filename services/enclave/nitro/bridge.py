"""Bounded TCP/vsock relay; no TLS termination or application cryptography here."""
import argparse
import selectors
import signal
import socket
import subprocess
import threading


def relay(left, right):
    with left, right, selectors.DefaultSelector() as selector:
        selector.register(left, selectors.EVENT_READ, right)
        selector.register(right, selectors.EVENT_READ, left)
        while selector.get_map():
            events = selector.select(timeout=15)
            if not events:
                return
            for key, _ in events:
                data = key.fileobj.recv(16_384)
                if data:
                    key.data.sendall(data)
                else:
                    selector.unregister(key.fileobj)
                    key.data.shutdown(socket.SHUT_WR)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["enclave", "parent"])
    parser.add_argument("--cid", type=int)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    child = None
    if args.mode == "enclave":
        child = subprocess.Popen(["node", "/app/dist/attestation-server.js"])
        listener = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        listener.bind((socket.VMADDR_CID_ANY, 5000))
    else:
        if args.cid is None or args.cid <= 3:
            parser.error("--cid must identify an enclave")
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((args.bind, args.port))
    listener.listen(32)
    listener.settimeout(1)
    slots = threading.BoundedSemaphore(32)

    def handle(connection):
        try:
            connection.settimeout(15)
            family = socket.AF_UNIX if args.mode == "enclave" else socket.AF_VSOCK
            with socket.socket(family, socket.SOCK_STREAM) as upstream:
                upstream.settimeout(15)
                address = "\0cloakroom-attestation" if args.mode == "enclave" else (args.cid, 5000)
                upstream.connect(address)
                relay(connection, upstream)
        except (OSError, ValueError):
            connection.close()
        finally:
            slots.release()

    def stop(_signum, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while child is None or child.poll() is None:
            try:
                connection, peer = listener.accept()
            except socket.timeout:
                continue
            if (args.mode == "enclave" and peer[0] != 3) or not slots.acquire(blocking=False):
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection,), daemon=True).start()
        raise SystemExit(1)
    finally:
        listener.close()
        if child is not None:
            child.terminate()
            child.wait(timeout=10)


if __name__ == "__main__":
    main()
