"""Unwrap KMS recipient CMS using an anonymous in-enclave key descriptor."""
import fcntl
import os
import subprocess
import sys


def main():
    with os.fdopen(3, "rb") as source:
        pem = bytearray(source.read(4097))
    ciphertext = sys.stdin.buffer.read(16385)
    if not 1 <= len(pem) <= 4096 or not 1 <= len(ciphertext) <= 16384:
        raise ValueError("invalid input")
    # Node's extra stdio descriptor is a socket, which OpenSSL cannot reopen as a file.
    # memfd has no filesystem path and is never shared with the parent instance.
    descriptor = os.memfd_create("kms-recipient", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    try:
        os.fchmod(descriptor, 0o600)
        os.write(descriptor, pem)
        pem[:] = b"\0" * len(pem)
        fcntl.fcntl(descriptor, fcntl.F_ADD_SEALS,
                    fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
        result = subprocess.run(["openssl", "cms", "-decrypt", "-inform", "DER", "-inkey",
                                 f"/proc/self/fd/{descriptor}"],
                                input=ciphertext, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                pass_fds=(descriptor,), timeout=4, check=True)
        if len(result.stdout) != 32:
            raise ValueError("invalid data key")
        sys.stdout.buffer.write(result.stdout)
    finally:
        pem[:] = b"\0" * len(pem)
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("KMS recipient decryption unavailable\n")
        sys.exit(1)
