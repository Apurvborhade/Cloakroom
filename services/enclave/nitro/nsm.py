"""NSM ioctl protocol: aws/aws-nitro-enclaves-nsm-api, src/driver/mod.rs."""
import base64
import ctypes
import fcntl
import os
import sys

import cbor2


def attest(public_key, user_data, nonce=None):
    if len(public_key) != 32 or len(user_data) != 32:
        raise ValueError("Invalid binding")
    if nonce is not None and not 32 <= len(nonce) <= 64:
        raise ValueError("Invalid nonce")
    request = cbor2.dumps({"Attestation": {
        "public_key": public_key, "user_data": user_data, "nonce": nonce,
    }})
    request_buffer = ctypes.create_string_buffer(request)
    response_buffer = ctypes.create_string_buffer(0x3000)
    # Linux uapi/linux/nsm.h: two iovecs (pointer, size) passed to _IOWR(0x0A, 0, ...).
    class Message(ctypes.Structure):
        _fields_ = [("request", ctypes.c_void_p), ("request_len", ctypes.c_size_t),
                    ("response", ctypes.c_void_p), ("response_len", ctypes.c_size_t)]
    message = Message(ctypes.addressof(request_buffer), len(request),
                      ctypes.addressof(response_buffer), len(response_buffer))
    fd = os.open("/dev/nsm", os.O_RDWR)
    try:
        fcntl.ioctl(fd, (3 << 30) | (ctypes.sizeof(Message) << 16) | (0x0A << 8), message)
    finally:
        os.close(fd)
    if not 0 < message.response_len <= len(response_buffer):
        raise RuntimeError("Invalid NSM response size")
    result = cbor2.loads(response_buffer.raw[:message.response_len])
    document = result.get("Attestation", {}).get("document")
    if not isinstance(document, bytes) or not document:
        raise RuntimeError("NSM attestation failed")
    return document


if __name__ == "__main__":
    try:
        args = [bytes.fromhex(value) for value in sys.argv[1:]]
        print(base64.b64encode(attest(*args)).decode("ascii"))
    except Exception:
        sys.stderr.write("NSM attestation unavailable\n")
        sys.exit(1)
