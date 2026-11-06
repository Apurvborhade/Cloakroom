"""Raw TLS byte relay. AWS certificate validation happens inside the enclave."""
import argparse
import re
import socket
import threading

from bridge import relay


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["enclave", "parent"])
    parser.add_argument("--region")
    parser.add_argument("--cid", type=int)
    args = parser.parse_args()
    if args.mode == "parent" and (not args.region or not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", args.region)
                                  or args.cid is None or args.cid <= 3):
        parser.error("parent requires a region and enclave CID")
    family = socket.AF_UNIX if args.mode == "enclave" else socket.AF_VSOCK
    with socket.socket(family, socket.SOCK_STREAM) as listener:
        listener.bind("\0cloakroom-kms" if args.mode == "enclave" else (socket.VMADDR_CID_ANY, 8000))
        listener.listen(16)
        slots = threading.BoundedSemaphore(16)

        def handle(connection):
            upstream = None
            try:
                connection.settimeout(15)
                if args.mode == "enclave":
                    upstream = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
                    upstream.settimeout(15)
                    upstream.connect((3, 8000))
                else:
                    upstream = socket.create_connection((f"kms.{args.region}.amazonaws.com", 443), timeout=15)
                relay(connection, upstream)
            except (OSError, ValueError):
                connection.close()
            finally:
                if upstream is not None:
                    upstream.close()
                slots.release()

        while True:
            connection, peer = listener.accept()
            if (args.mode == "parent" and peer[0] != args.cid) or not slots.acquire(blocking=False):
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection,), daemon=True).start()


if __name__ == "__main__":
    main()
