"""Synthetic PKI tests; these do not substitute for a real Nitro attestation."""
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
from pathlib import Path
import time
import unittest

import cbor2
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.x509.oid import NameOID

spec = importlib.util.spec_from_file_location("verifier", Path(__file__).parents[1] / "scripts/verify-attestation.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def certificate(key, subject, issuer, signer, ca, authority_key_id=True):
    now = datetime.now(timezone.utc)
    name = lambda value: x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, value)])
    builder = (x509.CertificateBuilder().subject_name(name(subject)).issuer_name(name(issuer))
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(hours=1)).not_valid_after(now + timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=ca, path_length=1 if ca else None), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=not ca, content_commitment=False,
                key_encipherment=False, data_encipherment=False, key_agreement=False,
                key_cert_sign=ca, crl_sign=ca, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False))
    if authority_key_id:
        builder = builder.add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(signer.public_key()), critical=False)
    return builder.sign(signer, hashes.SHA384())


class VerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root_key = ec.generate_private_key(ec.SECP384R1())
        cls.signing_key = ec.generate_private_key(ec.SECP384R1())
        cls.root = certificate(root_key, "test root", "test root", root_key, True)
        cls.root_key = root_key
        cls.leaf = certificate(cls.signing_key, "test leaf", "test root", root_key, False)
        cls.root_pem = cls.root.public_bytes(serialization.Encoding.PEM)
        cls.fingerprint = cls.root.fingerprint(hashes.SHA256()).hex()

    def setUp(self):
        self.now = time.time()
        self.build_hash = "ab" * 32
        self.nonce = b"challenge" * 4
        self.public_key = b"k" * 32
        self.pcrs = {i: bytes([i + 1]) * 48 for i in range(3)}
        self.measurements = {f"PCR{i}": value.hex() for i, value in self.pcrs.items()}
        self.document = {"module_id": "synthetic test", "digest": "SHA384",
            "timestamp": int(self.now * 1000), "nonce": self.nonce,
            "public_key": self.public_key,
            "user_data": hashlib.sha256(self.public_key + bytes.fromhex(self.build_hash)).digest(),
            "pcrs": self.pcrs, "certificate": self.leaf.public_bytes(serialization.Encoding.DER),
            "cabundle": [self.root.public_bytes(serialization.Encoding.DER)]}

    def response(self, document=None):
        protected = cbor2.dumps({1: -35})
        payload = cbor2.dumps(document or self.document)
        signed = cbor2.dumps(["Signature1", protected, b"", payload])
        r, s = decode_dss_signature(self.signing_key.sign(signed, ec.ECDSA(hashes.SHA384())))
        signature = r.to_bytes(48, "big") + s.to_bytes(48, "big")
        quote = cbor2.dumps([protected, {}, payload, signature])
        return {"quote": base64.b64encode(quote).decode(), "buildHash": "0x" + self.build_hash,
                "enclavePubKey": "0x" + self.public_key.hex(), "chainId": 11155111}

    def verify(self, response=None, **overrides):
        args = dict(response=response or self.response(), measurements=self.measurements,
                    build_hash=self.build_hash, nonce=self.nonce, root_pem=self.root_pem,
                    now=self.now, root_fingerprint=self.fingerprint)
        args.update(overrides)
        return verifier.verify(**args)

    def test_valid_signed_document(self):
        self.assertTrue(self.verify()["ok"])

    def escape_response(self):
        signer = "0x" + "aB" * 20
        document = deepcopy(self.document)
        document["user_data"] = hashlib.sha256(
            b"cloakroom/attestation/escape/v1\0" + self.public_key
            + bytes.fromhex(self.build_hash) + bytes.fromhex(signer[2:])).digest()
        return {**self.response(document), "escapeSigner": signer}

    def test_bound_escape_signer(self):
        response = self.escape_response()
        result = self.verify(response, expected_escape_signer=response["escapeSigner"].lower())
        self.assertEqual(result["escapeSigner"], response["escapeSigner"].lower())

    def test_escape_signer_cannot_be_changed_or_removed(self):
        for replacement in [None, "0x" + "cd" * 20]:
            with self.subTest(replacement=replacement), self.assertRaisesRegex(ValueError, "binding"):
                response = self.escape_response()
                if replacement is None:
                    del response["escapeSigner"]
                else:
                    response["escapeSigner"] = replacement
                self.verify(response)

    def test_old_quote_cannot_claim_an_escape_signer(self):
        response = {**self.response(), "escapeSigner": "0x" + "ab" * 20}
        with self.assertRaisesRegex(ValueError, "binding"):
            self.verify(response)

    def test_expected_escape_signer_is_required_and_must_match(self):
        for response in [self.response(), self.escape_response()]:
            with self.subTest(response=response.get("escapeSigner")), self.assertRaisesRegex(ValueError, "Wrong escape signer"):
                self.verify(response, expected_escape_signer="0x" + "cd" * 20)

    def test_malformed_escape_signer(self):
        for value in [None, 1, "0x" + "00" * 20, "0x" + "ab" * 19, "0x" + "xx" * 20]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "Invalid escape signer"):
                self.verify({**self.escape_response(), "escapeSigner": value})

    def test_nitro_leaf_without_authority_key_identifier(self):
        document = deepcopy(self.document)
        leaf = certificate(self.signing_key, "Nitro-style leaf", "test root",
                           self.root_key, False, authority_key_id=False)
        document["certificate"] = leaf.public_bytes(serialization.Encoding.DER)
        self.assertTrue(self.verify(self.response(document))["ok"])

    def test_tampered_signature(self):
        response = self.response()
        quote = bytearray(base64.b64decode(response["quote"]))
        quote[-1] ^= 1
        response["quote"] = base64.b64encode(quote).decode()
        with self.assertRaises(Exception):
            self.verify(response)

    def test_wrong_build_or_chain_or_key(self):
        for key, value in [("buildHash", "00" * 32), ("chainId", 1),
                           ("enclavePubKey", "0x" + (b"x" * 32).hex())]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                response = self.response()
                response[key] = value
                self.verify(response)

    def test_wrong_challenge(self):
        with self.assertRaisesRegex(ValueError, "nonce"):
            self.verify(nonce=b"x" * 32)

    def test_stale_or_future_document(self):
        for seconds in [-301, 31]:
            with self.subTest(seconds=seconds), self.assertRaisesRegex(ValueError, "Stale"):
                document = deepcopy(self.document)
                document["timestamp"] += seconds * 1000
                self.verify(self.response(document))

    def test_wrong_measurement_and_debug_mode(self):
        with self.assertRaisesRegex(ValueError, "PCR0"):
            self.verify(measurements={**self.measurements, "PCR0": "ff" * 48})
        document = deepcopy(self.document)
        document["pcrs"] = {i: bytes(48) for i in range(3)}
        with self.assertRaisesRegex(ValueError, "PCR0"):
            self.verify(self.response(document))

    def test_wrong_binding(self):
        document = deepcopy(self.document)
        document["user_data"] = bytes(32)
        with self.assertRaisesRegex(ValueError, "binding"):
            self.verify(self.response(document))

    def test_untrusted_root(self):
        with self.assertRaisesRegex(ValueError, "Untrusted root"):
            self.verify(root_fingerprint=verifier.ROOT_SHA256)

    def test_invalid_certificate_chain(self):
        rogue = ec.generate_private_key(ec.SECP384R1())
        document = deepcopy(self.document)
        document["certificate"] = certificate(self.signing_key, "rogue", "rogue", rogue, False).public_bytes(serialization.Encoding.DER)
        with self.assertRaisesRegex(ValueError, "chain validation"):
            self.verify(self.response(document))


if __name__ == "__main__":
    unittest.main()
