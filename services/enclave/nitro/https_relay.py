"""Bounded HTTPS byte relay. TLS is authenticated inside the enclave."""
import argparse
import os
import re
import socket
import threading

from bridge import relay


def run(*, port, socket_name, host=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["enclave", "parent"])
    parser.add_argument("--cid", type=int)
    parser.add_argument("--unix-socket", help="Parent-side local integration tests only")
    if host is None:
        parser.add_argument("--host", help="Public RPC hostname only; no URL or credentials")
    args = parser.parse_args()
    host = host or getattr(args, "host", None)
    if args.mode == "parent" and (not host or not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?", host)):
        parser.error("parent requires a public HTTPS hostname")
    if args.mode == "parent" and not args.unix_socket and (args.cid is None or args.cid <= 3):
        parser.error("parent requires an enclave CID")
    if args.mode == "enclave" and args.unix_socket:
        parser.error("enclave uses its fixed abstract socket")
    local = args.mode == "enclave" or args.unix_socket
    with socket.socket(socket.AF_UNIX if local else socket.AF_VSOCK, socket.SOCK_STREAM) as listener:
        listener.bind(args.unix_socket or (socket_name if local else (socket.VMADDR_CID_ANY, port)))
        if args.unix_socket:
            os.chmod(args.unix_socket, 0o600)
        listener.listen(16)
        slots = threading.BoundedSemaphore(16)

        def handle(connection):
            upstream = None
            try:
                connection.settimeout(15)
                if args.mode == "enclave":
                    upstream = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
                    upstream.settimeout(15)
                    upstream.connect((3, port))
                else:
                    upstream = socket.create_connection((host, 443), timeout=15)
                relay(connection, upstream)
            except (OSError, ValueError):
                connection.close()
            finally:
                if upstream is not None:
                    upstream.close()
                slots.release()

        while True:
            connection, peer = listener.accept()
            if (args.mode == "parent" and not args.unix_socket and peer[0] != args.cid) or not slots.acquire(blocking=False):
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection,), daemon=True).start()
