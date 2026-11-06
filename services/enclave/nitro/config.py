"""CID-restricted private boot configuration. The enclave verifies its image commitment."""
import argparse
import os
import socket
import stat
import struct
import threading

from bridge import relay

MAX_BYTES = 65_536
PORT = 8004


def read_config(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid():
            raise ValueError("INVALID_CONFIG_FILE")
        if info.st_size > MAX_BYTES:
            raise ValueError("INVALID_CONFIG_FILE")
        data = source.read(MAX_BYTES + 1)
        if not data or len(data) > MAX_BYTES:
            raise ValueError("INVALID_CONFIG_FILE")
        return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["enclave", "parent"])
    parser.add_argument("--cid", type=int)
    parser.add_argument("--file")
    parser.add_argument("--unix-socket", help="Parent-side integration tests only")
    args = parser.parse_args()
    if args.mode == "parent" and (not args.file or (not args.unix_socket and (args.cid is None or args.cid <= 3))):
        parser.error("parent requires a private file and an enclave CID")
    if args.mode == "enclave" and (args.file or args.unix_socket):
        parser.error("enclave uses its fixed abstract socket")
    if args.mode == "parent":
        try:
            read_config(args.file)
        except (OSError, ValueError):
            raise SystemExit("CONFIG_UNAVAILABLE") from None
    local = args.mode == "enclave" or args.unix_socket
    with socket.socket(socket.AF_UNIX if local else socket.AF_VSOCK, socket.SOCK_STREAM) as listener:
        listener.bind(args.unix_socket or ("\0cloakroom-config" if local else (socket.VMADDR_CID_ANY, PORT)))
        if args.unix_socket:
            os.chmod(args.unix_socket, 0o600)
        listener.listen(4)
        slots = threading.BoundedSemaphore(4)

        def handle(connection):
            try:
                with connection:
                    connection.settimeout(5)
                    if args.mode == "enclave":
                        with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as upstream:
                            upstream.settimeout(5)
                            upstream.connect((3, PORT))
                            relay(connection, upstream)
                    else:
                        request = b""
                        while len(request) < 4:
                            part = connection.recv(4 - len(request))
                            if not part:
                                return
                            request += part
                        if request != b"GET\n":
                            return
                        data = read_config(args.file)
                        connection.sendall(struct.pack("!I", len(data)) + data)
            except (OSError, ValueError):
                pass
            finally:
                slots.release()

        while True:
            connection, peer = listener.accept()
            if (args.mode == "parent" and not args.unix_socket and peer[0] != args.cid) or not slots.acquire(blocking=False):
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection,), daemon=True).start()


if __name__ == "__main__":
    main()
