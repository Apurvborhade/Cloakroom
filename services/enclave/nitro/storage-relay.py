"""In-enclave socket to parent ciphertext store. Keys are never sent through this relay."""
import socket
import threading
from bridge import relay


def main():
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind("\0cloakroom-storage")
        listener.listen(16)
        slots = threading.BoundedSemaphore(16)

        def handle(connection):
            try:
                connection.settimeout(15)
                with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as upstream:
                    upstream.settimeout(15)
                    upstream.connect((3, 8001))
                    relay(connection, upstream)
            except (OSError, ValueError):
                connection.close()
            finally:
                slots.release()

        while True:
            connection, _ = listener.accept()
            if not slots.acquire(blocking=False):
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection,), daemon=True).start()


if __name__ == "__main__":
    main()
