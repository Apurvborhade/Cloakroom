# Nitro operations

The shipped entrypoint is an attestation bootstrap with an unfunded custody self-test. It does not serve the deposit, intent or withdrawal API. Custody modules are packaged and tested; live custody stays disabled until the application bootstrap is wired and KMS recovery is verified.

## Build and launch

Run from the repository root on the ARM64 parent:

```sh
TMPDIR=/path/to/disk-scratch bash infra/nitro/build-release.sh /path/to/release
nitro-cli run-enclave --cpu-count 1 --memory 2048 --enclave-cid 16 \
  --enclave-name cloakroom-attestation --eif-path /path/to/release/attestation.eif
python3 services/enclave/nitro/bridge.py parent --cid 16
```

Reserve one CPU and 2048 MiB in `/etc/nitro_enclaves/allocator.yaml`. Keep the YAML `---` marker: the AWS allocator parser requires it. Stop existing enclaves before restarting the allocator. On a small parent, image creation may need temporary swap and disk scratch space instead of `/tmp` on tmpfs. Build failures must not trigger replacement of an existing good release.

Verify a fresh quote with `scripts/verify-attestation.py`, trusted `measurements.json` and `build-hash`. `release.json` records the Docker image ID, EIF SHA-256 and PCRs. These are different digests. Never select expected measurements from an untrusted response.

## Persistent custody

1. Supply trusted PCR0–2, a stable random public `VaultId` and an existing key administrator role to `kms.template.json`. The template creates a retained KMS key, EC2 role and instance profile. Validate the CloudFormation template in the target account before creating the stack. Live provisioning has not been performed.
2. Attach the resulting instance profile to the parent. Its credentials alone cannot obtain a plaintext wrapping key. The policy requires recipient attestation and the selected measurements and encryption context. The key administrator remains trusted because it can edit policy.
3. Run `storage.py --cid 16 --directory /var/lib/cloakroom` and `kms-relay.py parent --region REGION --cid 16` on the parent. Both listen on vsock only, restricted to that enclave CID. The enclave bridge starts the matching internal relays.
4. Call `openNitroRuntime({ keyArn, region, vaultId, policy, buildHash, allowCreate })`. Initial provisioning explicitly opts into creation and requires all three blobs absent. Ordinary restarts omit `allowCreate`. Parent role credentials are fetched through IMDSv2; no static AWS keys are required.
5. Use the returned `keys`, `journal`, `ledger` and `attestation`. Restore remaining application state and executor operations before mounting routes. Journal snapshots are capped at 4 MiB; failed or uncertain storage writes require a runtime restart.
6. Test an actual enclave restart with the same state and KMS policy before funding. Preserve `wrapping.blob`, `custody.blob` and `journal.blob` together; take backups with writes stopped. Missing or damaged blobs stop startup.

AWS API behavior follows [GenerateDataKey recipient responses](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html) and [Nitro attestation conditions](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-nitro-enclave.html).

KMS TLS terminates inside the enclave. The parent relays encrypted bytes to a fixed regional AWS endpoint. Recipient CMS by itself does not authenticate the KMS server. The RSA key is generated inside the enclave, supplied to NSM, and passed to the CMS helper through a private pipe and anonymous memory descriptor. The host sees wrapped KMS keys and authenticated custody ciphertext only.

Revision CAS and the signing journal catch stale concurrent writers and vault rollback relative to the journal. A malicious host rolling back all stored state together still needs an external trusted checkpoint. Missing or corrupt state causes refusal; do not repair it by silently generating a new seed.

## Services and HTTPS

The supplied systemd units expect Nitro helpers in `/opt/cloakroom/nitro/`, a release in `/opt/cloakroom/current/`, and public settings in `/etc/cloakroom/parent.env`:

```dotenv
ENCLAVE_CID=16
ENCLAVE_MEMORY=2048
AWS_REGION=REGION
```

From the repository root, `sudo bash infra/nitro/install-parent.sh /absolute/release REGION` verifies the EIF digest and installs the helpers, release and units. It preserves an existing parent configuration and does not stop or start an enclave. Confirm allocator settings, then stop any previous manual instance and start the services. Enable storage/KMS relays before the custody application. The enclave unit starts a non-debug enclave; verify health and a fresh quote after each restart. It is a oneshot launch unit, so enclave process failure also needs external health monitoring.

`Caddyfile` prepares HTTPS forwarding to the loopback ingress. Set `ENCLAVE_DOMAIN` to a controlled DNS name pointing to the parent and allow TCP 80/443 in the security group. Then validate and run Caddy. DNS, certificate issuance and public reachability are still pending. Caddy access logging is disabled by default; do not add request/response body logs.

## Remaining integration

- Live IAM/KMS provisioning, policy validation and Nitro restart recovery.
- Application server wiring, swap authorization and RPC egress.
- Public domain, HTTPS and frontend URL handoff.
- Deterministic OS package snapshots and build timestamps for independently matching image PCRs.
- Funding after verified deployment, followed by disabling the seeding route.
