"""Untrusted parent ciphertext storage with atomic CAS; never accepts plaintext keys."""
import argparse
import fcntl
import hashlib
import json
from http.server import BaseHTTPRequestHandler
import os
from pathlib import Path
import re
import socket
import tempfile
import threading
import urllib.request

MAX_BYTES = 4 * 1024 * 1024


def role_credentials():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = "http://169.254.169.254/latest/"
    token_request = urllib.request.Request(base + "api/token", method="PUT",
                                          headers={"X-aws-ec2-metadata-token-ttl-seconds": "600"})
    with opener.open(token_request, timeout=2) as response:
        token = response.read(4097).decode("ascii")
    if not 1 <= len(token) <= 4096:
        raise ValueError("invalid IMDS token")

    def fetch(path, maximum):
        request = urllib.request.Request(base + path, headers={"X-aws-ec2-metadata-token": token})
        with opener.open(request, timeout=2) as response:
            data = response.read(maximum + 1)
            if len(data) > maximum:
                raise ValueError("invalid metadata size")
            return data

    role = fetch("meta-data/iam/security-credentials/", 128).decode("ascii").strip()
    if not re.fullmatch(r"[A-Za-z0-9_+=,.@-]{1,128}", role):
        raise ValueError("invalid role name")
    data = fetch("meta-data/iam/security-credentials/" + role, 24576)
    if json.loads(data).get("Code") != "Success":
        raise ValueError("role unavailable")
    return data


def read_blob(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    with os.fdopen(descriptor, "rb") as source:
        data = source.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("oversized blob")
        return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--cid", type=int)
    parser.add_argument("--unix-socket", help="Local integration tests only; never a public TCP listener")
    args = parser.parse_args()
    if not args.unix_socket and (args.cid is None or args.cid <= 3):
        parser.error("--cid is required for vsock storage")
    args.directory.mkdir(mode=0o700, parents=True, exist_ok=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            pass

        def respond(self, status, data=b""):
            self.send_response(status)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def handle_blob(self, writing):
            match = re.fullmatch(r"/blobs/([a-f0-9]{64})/(custody|wrapping|journal)", self.path)
            if not match:
                self.respond(400)
                return
            directory = args.directory / match[1]
            directory.mkdir(mode=0o700, exist_ok=True)
            root = os.open(args.directory, os.O_DIRECTORY)
            try:
                os.fsync(root)
            finally:
                os.close(root)
            path = directory / (match[2] + ".blob")
            if not writing:
                data = read_blob(path)
                self.respond(404 if data is None else 200, data or b"")
                return
            expected = self.headers.get("If-Match", "")
            length = self.headers.get("Content-Length", "")
            if (expected != "none" and not re.fullmatch(r"[a-f0-9]{64}", expected)) or not re.fullmatch(r"[0-9]{1,8}", length):
                self.respond(400)
                return
            length = int(length)
            if length > MAX_BYTES:
                self.respond(413)
                return
            data = self.rfile.read(length)
            if len(data) != length:
                self.respond(400)
                return
            lock = os.open(str(path) + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    self.respond(409)
                    return
                previous = read_blob(path)
                actual = hashlib.sha256(previous).hexdigest() if previous is not None else "none"
                if actual != expected:
                    self.respond(409)
                    return
                descriptor, temporary = tempfile.mkstemp(prefix=".ciphertext-", dir=directory)
                try:
                    with os.fdopen(descriptor, "wb") as target:
                        target.write(data)
                        target.flush()
                        os.fsync(target.fileno())
                    os.replace(temporary, path)
                    parent = os.open(directory, os.O_DIRECTORY)
                    try:
                        os.fsync(parent)
                    finally:
                        os.close(parent)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
                self.respond(200)
            finally:
                os.close(lock)

        def do_GET(self):
            try:
                if self.path == "/role-credentials":
                    self.respond(200, role_credentials())
                    return
                self.handle_blob(False)
            except (OSError, ValueError):
                self.respond(503)

        def do_POST(self):
            try:
                self.handle_blob(True)
            except (OSError, ValueError):
                self.respond(503)

    family = socket.AF_UNIX if args.unix_socket else socket.AF_VSOCK
    with socket.socket(family, socket.SOCK_STREAM) as listener:
        listener.bind(args.unix_socket or (socket.VMADDR_CID_ANY, 8001))
        if args.unix_socket:
            os.chmod(args.unix_socket, 0o600)
        listener.listen(16)
        slots = threading.BoundedSemaphore(16)

        def handle(connection, peer):
            try:
                connection.settimeout(15)
                with connection:
                    Handler(connection, peer, None)
            except (OSError, ValueError):
                connection.close()
            finally:
                slots.release()

        while True:
            connection, peer = listener.accept()
            if (not args.unix_socket and peer[0] != args.cid) or not slots.acquire(blocking=False):
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection, peer), daemon=True).start()


if __name__ == "__main__":
    main()
