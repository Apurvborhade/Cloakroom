# Nitro operations

Images built without configuration serve the attestation bootstrap. A configured image starts the application server with persistent custody. The deployed release is still the bootstrap; the application image needs its own KMS policy measurements and live recovery verification before funding.

## Build and launch

Run from the repository root on the ARM64 parent:

```sh
TMPDIR=/path/to/disk-scratch bash infra/nitro/build-release.sh /path/to/release
nitro-cli run-enclave --cpu-count 1 --memory 2048 --enclave-cid 16 \
  --enclave-name cloakroom-attestation --eif-path /path/to/release/attestation.eif
python3 services/enclave/nitro/bridge.py parent --cid 16
```

Reserve one CPU and 2048 MiB in `/etc/nitro_enclaves/allocator.yaml`. Keep the YAML `---` marker: the AWS allocator parser requires it. Stop existing enclaves before restarting the allocator. On a small parent, use disk scratch space instead of `/tmp` on tmpfs and bound packaging memory: the 4 GiB parent completed `nitro-cli build-enclave` under systemd with `MemoryMax=1G`, `MemorySwapMax=2G` and 3 GiB temporary swap available. Remove temporary swap after the build. Build failures must not trigger replacement of an existing good release.

Verify a fresh quote with `scripts/verify-attestation.py`, trusted `measurements.json` and `build-hash`. `release.json` records the Docker image ID, EIF SHA-256 and PCRs. These are different digests. Never select expected measurements from an untrusted response.

## Private application configuration

Create a UTF-8 JSON object outside the repository containing every variable in `.env.example`, plus `KMS_KEY_ARN`, `KMS_REGION` and `VAULT_ID`. All values are strings; use `SIM_MODE=false` and mode `0600`. Do not include shell variables such as `NODE_OPTIONS` or simulation keys.

```sh
TMPDIR=/path/to/disk-scratch bash infra/nitro/build-release.sh \
  /path/to/release cloakroom-application:release /private/enclave.json
sudo install -m 0600 /private/enclave.json /etc/cloakroom/enclave.json
sudo systemctl enable --now cloakroom-config
```

Install the supplied helpers and service units first. Only the file's SHA-256 enters the image and build hash. At startup, the bridge selects `main.js --nitro`; it fetches the private file through the CID-restricted config service on vsock 8004 and rejects any mismatch before opening custody. Values are parsed as configuration, never shell environment overrides. HTTP uses the existing enclave socket and parent ingress.

Changing any configuration bytes requires rebuilding the image and updating trusted KMS measurements. Use `CUSTODY_ALLOW_CREATE=true` only for initial provisioning; the funded release must use `false`. The parent holds API credentials in this private file, while custody keys remain inside the enclave.

## Persistent custody

1. Supply trusted PCR0–2, a stable random public `VaultId` and an existing key administrator role to `kms.template.json`. The template creates a retained KMS key, EC2 role and instance profile. Validate the CloudFormation template in the target account before creating the stack. Demo resources were provisioned through the console; the template has not been deployed as a stack.
2. Attach the resulting instance profile to the parent. Its credentials alone cannot obtain a plaintext wrapping key. The policy requires recipient attestation and the selected measurements and encryption context. The key administrator remains trusted because it can edit policy.
3. Run `storage.py --cid 16 --directory /var/lib/cloakroom` and `kms-relay.py parent --region REGION --cid 16` on the parent. Both listen on vsock only, restricted to that enclave CID. The enclave bridge starts the matching internal relays.
4. `main.ts` opens `openNitroRuntime` with signing limits from the verified configuration. Initial provisioning requires all three blobs absent and explicit creation permission. Ordinary restarts refuse missing state. Parent role credentials are fetched through IMDSv2; no static AWS keys are required.
5. `bootEnclave` uses the returned `keys`, snapshot `journal`, restored `ledger` and `attestation`, then restores intents, inventory, watcher and executor operations before listening. Journal snapshots are capped at 4 MiB; failed or uncertain storage writes require a runtime restart.
6. Test an actual enclave restart with the same state and KMS policy before funding. Preserve `wrapping.blob`, `custody.blob` and `journal.blob` together; take backups with writes stopped. Missing or damaged blobs stop startup.

An unfunded, non-debug Nitro test verified KMS-backed state creation and recovery after enclave and storage-service restarts: identity, cached transaction, journal and balances matched; duplicate signing and seeding disclosure stayed blocked. Fresh AWS quotes verified before and after recovery. Parent `GenerateDataKey` and `Decrypt` calls without recipient attestation were denied. The demo KMS policy permits the test image; update its trusted PCRs for the final application image and repeat recovery before funding.

AWS API behavior follows [GenerateDataKey recipient responses](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html) and [Nitro attestation conditions](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-nitro-enclave.html).

KMS TLS terminates inside the enclave. The parent relays encrypted bytes to a fixed regional AWS endpoint. Recipient CMS by itself does not authenticate the KMS server. The RSA key is generated inside the enclave, supplied to NSM, and passed to the CMS helper through a private pipe and anonymous memory descriptor. The host sees wrapped KMS keys and authenticated custody ciphertext only.

Revision CAS and the signing journal catch stale concurrent writers and vault rollback relative to the journal. A malicious host rolling back all stored state together still needs an external trusted checkpoint. Missing or corrupt state causes refusal; do not repair it by silently generating a new seed.

## Uniswap egress

`createNitroUniswapClient(config)` uses `\0cloakroom-uniswap` and vsock port 8002. `main.ts` selects it when `SIM_MODE=false`. Enable `cloakroom-uniswap.service` on the parent; the enclave bridge starts its internal relay. The only destination is `trade-api.gateway.uniswap.org:443`, with `UNISWAP_API_URL=https://trade-api.gateway.uniswap.org/v1`.

TLS certificate and hostname checks run inside the enclave. Redirects are refused, responses are capped at 1 MiB, and the quote timeout covers the response body. A missing relay fails the quote; there is no direct-network fallback.

An independently attested, non-debug Nitro test image completed an authenticated Sepolia quote and RPC reads. No transaction was broadcast.

## RPC egress

`main.ts` selects `createNitroRpcTransport(RPC_URL)` when `SIM_MODE=false`. Set only the RPC hostname as `RPC_HOST` in `/etc/cloakroom/parent.env` and enable `cloakroom-rpc.service`. It forwards vsock port 8003 to that host on port 443; the enclave uses `\0cloakroom-rpc` and checks the TLS certificate and hostname itself.

Supply the full HTTPS `RPC_URL` privately to the enclave. Its credential-bearing path stays inside TLS and is omitted from transport error URLs. Redirects and direct-network fallback are refused; requests time out after 10 seconds and responses are capped at 10 MiB. Keep both RPC and Uniswap credentials out of source control and images.

## Services and HTTPS

The supplied systemd units expect Nitro helpers in `/opt/cloakroom/nitro/`, a release in `/opt/cloakroom/current/`, and public settings in `/etc/cloakroom/parent.env`:

```dotenv
ENCLAVE_CID=16
ENCLAVE_MEMORY=2048
AWS_REGION=REGION
RPC_HOST=rpc-provider.example
```

From the repository root, `sudo bash infra/nitro/install-parent.sh /absolute/release REGION` verifies the EIF digest and installs the helpers, release and units. It preserves an existing parent configuration and does not stop or start an enclave. Confirm allocator settings, then stop any previous manual instance and start the services. Enable storage/KMS relays before the custody application. The enclave unit starts a non-debug enclave; verify health and a fresh quote after each restart. It is a oneshot launch unit, so enclave process failure also needs external health monitoring.

`Caddyfile` prepares HTTPS forwarding to the loopback ingress. Set `ENCLAVE_DOMAIN` to a controlled DNS name pointing to the parent and allow TCP 80/443 in the security group. Then validate and run Caddy. DNS, certificate issuance and public reachability are still pending. Caddy access logging is disabled by default; do not add request/response body logs.

## Remaining integration

- KMS authorization and live recovery verification of the configured application images; private API integration and image self-tests pass.
- Public domain, HTTPS and frontend URL handoff.
- Deterministic OS package snapshots and build timestamps for independently matching image PCRs.
- Fund unlinked inventory after verified deployment. Operator seeding is optional and remains disabled in the current application configuration.
