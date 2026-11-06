# services/enclave

The TEE service. Module ownership: see [docs/enclave.md](../../docs/enclave.md).

The commands below build the attestation-only bootstrap. To start `main.ts` with persistent custody, use the [private application configuration](../../infra/nitro/README.md#private-application-configuration) build path.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
docker build -f services/enclave/Dockerfile -t cloakroom-attestation .
nitro-cli build-enclave --docker-uri cloakroom-attestation:latest --output-file /tmp/cloakroom.eif > /tmp/measurements.json
nitro-cli run-enclave --cpu-count 1 --memory 2048 --enclave-cid 16 --enclave-name cloakroom --eif-path /tmp/cloakroom.eif
python3 services/enclave/nitro/bridge.py parent --cid 16
```

Build on an ARM64 Nitro-enabled parent with Docker, Nitro CLI, and its allocator reserving 1 vCPU and 2048 MiB. Keep debug mode disabled. The bridge listens on `127.0.0.1:8080`; `GET /attestation` is relayed over vsock to Node inside the enclave. No public ingress or TLS is configured by these commands.

Verify from a machine with Python 3.10+ and OpenSSL 3, using a tunnel if needed:

```sh
python3 -m venv /tmp/cloakroom-verifier
/tmp/cloakroom-verifier/bin/pip install -r scripts/attestation-requirements.txt
docker run --rm --entrypoint cat cloakroom-attestation /app/dist/build-hash
/tmp/cloakroom-verifier/bin/python scripts/verify-attestation.py \
  --url http://127.0.0.1:8080/attestation \
  --measurements /tmp/measurements.json --build-hash <expected-build-hash>
```

Supply trusted measurements from your build, not values copied from an unverified quote. The verifier checks the pinned AWS root, X.509 chain, COSE signature, fresh nonce, timestamp, PCR0–2 and key/build binding. The included AWS root is public certificate material, not a private key; its SHA-256 fingerprint is pinned in the verifier.

The build hash covers enclave sources, build configuration and the pnpm lockfile. PCRs identify the complete enclave image. Final byte-for-byte build reproducibility remains a release task.


Browser transport verification:

```sh
pnpm exec playwright install chromium
pnpm test:hpke:browser
```

This bundles the shared sealing function for Chromium, checks concurrent request encryption, route binding and an authenticated encrypted response.

The full production dependency tree is packaged with `pnpm deploy --prod --legacy`. The bootstrap runs an unfunded signing/restart/HPKE self-test before serving attestation. See [the Nitro runbook](../../infra/nitro/README.md) for KMS recipient sealing, ciphertext persistence, services and the remaining live configuration.

The deployed ARM64 [application release](../../infra/nitro/application-release.json) includes trusted build/EIF hashes and PCRs. KMS-backed custody, encrypted API access and restart recovery are verified; seeding is disabled. The earlier [bootstrap release](../../infra/nitro/bootstrap-release.json) serves attestation only.
