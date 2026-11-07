#!/usr/bin/env python3
"""Verify a fresh Nitro quote against the AWS root and trusted build measurements."""
import argparse
import base64
import hashlib
import hmac
import io
import json
import re
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

import cbor2
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

ROOT_SHA256 = "641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def decode_cbor(data):
    stream = io.BytesIO(data)
    result = cbor2.load(stream)
    require(not stream.read(1), "Trailing CBOR data")
    return result


def verify(response, measurements, build_hash, nonce, root_pem,
           chain_id=11155111, now=None, root_fingerprint=ROOT_SHA256,
           expected_escape_signer=None):
    require(isinstance(response, dict), "Invalid response")
    require(response.get("chainId") == chain_id, "Wrong chain ID")
    require(isinstance(build_hash, str) and len(build_hash) in (64, 66),
            "Expected SHA-256 build hash required")
    build_hash = build_hash.removeprefix("0x")
    require(re.fullmatch(r"[0-9a-f]{64}", build_hash), "Invalid expected build hash")
    require(response.get("buildHash") == "0x" + build_hash, "Wrong build hash")
    require(isinstance(response.get("enclavePubKey"), str)
            and re.fullmatch(r"0x[0-9a-f]{64}", response["enclavePubKey"]), "Invalid public key")
    public_key = bytes.fromhex(response["enclavePubKey"][2:])
    quote = base64.b64decode(response["quote"], validate=True)
    require(len(public_key) == 32 and 0 < len(quote) <= 16_384, "Invalid quote/key size")
    cose = decode_cbor(quote)
    if isinstance(cose, cbor2.CBORTag):
        require(cose.tag == 18, "Wrong COSE tag")
        cose = cose.value
    require(isinstance(cose, (list, tuple)) and len(cose) == 4, "Invalid COSE Sign1")
    protected, unprotected, payload, signature = cose
    require(isinstance(protected, bytes) and isinstance(payload, bytes)
            and isinstance(signature, bytes), "Invalid COSE field types")
    require(decode_cbor(protected) == {1: -35} and unprotected == {}, "Expected ES384")
    document = decode_cbor(payload)
    require(isinstance(document, dict) and document.get("digest") == "SHA384",
            "Invalid attestation document")
    require(isinstance(document.get("module_id"), str) and document["module_id"],
            "Missing module identity")

    root = x509.load_pem_x509_certificate(root_pem)
    require(root.fingerprint(hashes.SHA256()).hex() == root_fingerprint,
            "Untrusted root certificate")
    leaf = x509.load_der_x509_certificate(document["certificate"])
    require(not leaf.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
            and leaf.extensions.get_extension_for_class(x509.KeyUsage).value.digital_signature,
            "Invalid attestation signing certificate")
    bundle = document["cabundle"]
    require(isinstance(bundle, (list, tuple)) and 0 < len(bundle) <= 16,
            "Invalid certificate bundle")
    intermediates = b"".join(x509.load_der_x509_certificate(cert)
                             .public_bytes(serialization.Encoding.PEM) for cert in bundle)
    with tempfile.TemporaryDirectory(prefix="cloakroom-attestation-") as directory:
        path = Path(directory)
        (path / "root.pem").write_bytes(root_pem)
        (path / "leaf.pem").write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
        (path / "chain.pem").write_bytes(intermediates)
        # Nitro leaf certificates can omit AuthorityKeyIdentifier. Standard OpenSSL
        # path validation still checks signatures, validity, CA constraints and trust.
        result = subprocess.run([
            "openssl", "verify", "-no-CApath", "-no-CAstore",
            "-CAfile", str(path / "root.pem"), "-untrusted", str(path / "chain.pem"),
            str(path / "leaf.pem"),
        ], capture_output=True, timeout=10)
        require(result.returncode == 0, "Certificate chain validation failed")

    signing_key = leaf.public_key()
    require(isinstance(signing_key, ec.EllipticCurvePublicKey)
            and isinstance(signing_key.curve, ec.SECP384R1)
            and len(signature) == 96, "Invalid ES384 signature/key")
    der_signature = encode_dss_signature(int.from_bytes(signature[:48], "big"),
                                        int.from_bytes(signature[48:], "big"))
    signing_key.verify(der_signature, cbor2.dumps(["Signature1", protected, b"", payload]),
                       ec.ECDSA(hashes.SHA384()))

    current_ms = int((time.time() if now is None else now) * 1000)
    timestamp = document.get("timestamp")
    require(type(timestamp) is int and current_ms - 300_000 <= timestamp <= current_ms + 30_000,
            "Stale or future attestation")
    require(isinstance(document.get("nonce"), bytes)
            and hmac.compare_digest(document["nonce"], nonce), "Wrong challenge nonce")
    require(document.get("public_key") == public_key, "Wrong public key")
    escape_signer = response.get("escapeSigner")
    binding_input = public_key + bytes.fromhex(build_hash)
    if "escapeSigner" in response:
        require(isinstance(escape_signer, str)
                and re.fullmatch(r"0x[0-9a-fA-F]{40}", escape_signer)
                and int(escape_signer[2:], 16) != 0, "Invalid escape signer")
        escape_signer = escape_signer.lower()
        binding_input = (b"cloakroom/attestation/escape/v1\0" + binding_input
                         + bytes.fromhex(escape_signer[2:]))
    if expected_escape_signer is not None:
        require(isinstance(expected_escape_signer, str)
                and re.fullmatch(r"0x[0-9a-fA-F]{40}", expected_escape_signer)
                and escape_signer == expected_escape_signer.lower(), "Wrong escape signer")
    binding = hashlib.sha256(binding_input).digest()
    require(document.get("user_data") == binding, "Wrong key/build binding")
    pcrs = document.get("pcrs")
    require(isinstance(pcrs, dict), "Missing PCRs")
    expected = measurements.get("Measurements", measurements)
    for index in range(3):
        measured = pcrs.get(index)
        trusted = bytes.fromhex(expected[f"PCR{index}"])
        require(len(trusted) == 48 and trusted != bytes(48), "Invalid trusted PCR")
        require(isinstance(measured, bytes) and hmac.compare_digest(measured, trusted),
                f"PCR{index} mismatch (wrong image or debug mode)")
    result = {"ok": True, "buildHash": "0x" + build_hash, "chainId": chain_id}
    if escape_signer is not None:
        result["escapeSigner"] = escape_signer
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="URL ending in /attestation")
    parser.add_argument("--measurements", required=True, type=Path,
                        help="Trusted nitro-cli build-enclave JSON; never take PCRs from the quote")
    parser.add_argument("--build-hash", required=True)
    parser.add_argument("--escape-signer", help="Expected EscapeHatch signer address, when enabled")
    args = parser.parse_args()
    nonce = secrets.token_bytes(32)
    parts = urllib.parse.urlsplit(args.url)
    require(parts.scheme in ("http", "https") and parts.path == "/attestation"
            and not parts.query and not parts.fragment, "Invalid attestation URL")
    url = urllib.parse.urlunsplit(parts._replace(query="nonce=" + nonce.hex()))
    with urllib.request.urlopen(url, timeout=15) as result:
        raw = result.read(65_537)
    require(len(raw) <= 65_536, "Response too large")
    result = verify(json.loads(raw), json.loads(args.measurements.read_text()),
                    args.build_hash, nonce, Path(__file__).with_name("nitro-root.pem").read_bytes(),
                    expected_escape_signer=args.escape_signer)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Attestation verification failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
