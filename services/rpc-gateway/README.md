# Isolated RPC gateway

HTTPS JSON-RPC for wallet-signed `eth_sendRawTransaction` and common wallet reads. Wallet keys stay in the wallet. Signing/admin methods are refused. Bodies, responses, connections and timeouts are bounded. A timed-out transaction is never resubmitted automatically; query its hash before deciding what to do next. Payloads and client addresses are not logged.

The native transport uses the official Nox SDK and its TLS tunnel protocol. Node validates the upstream certificate inside the enclave; Nox exits relay encrypted TLS bytes. Repeated tunnel frames retain the same sequence and bytes, which the exit writes once. This is a Nox integration, not a completed implementation of the generic Anon-RPC Node harness. Tor and Nym adapters are not included. The separate browser compatibility probe still exercises the existing Anon-RPC browser harness.

The Nitro image commits to the boot configuration. It generates its TLS key inside the enclave and seals it with recipient-attested KMS under a separate vault ID. The parent forwards TCP and stores ciphertext. The parent still sees connection IPs and timing; Nox testnet deployment does not establish independence of its node operators.

The parent-loopback control endpoint on port 9081 exposes `GET /csr`, `GET /status` and `POST /certificate` (PEM full chain). It never exports the private key. Obtain a public certificate from that CSR, then upload it; renewal uses the same CSR and does not change the image. RPC starts only after a matching, current certificate is installed. Back up the encrypted state. Remove the initial KMS `GenerateDataKey` grant after provisioning; runtime needs `Decrypt`. Losing the wrapping blob then blocks boot. Losing only the TLS identity requires a new key and certificate; no wallet funds depend on this key.

The optional `infra/rpc/cloakroom-rpc-certificate.timer` checks daily and renews through Certbot HTTP-01 when fewer than 30 days remain. It needs inbound port 80 and Certbot at `/opt/cloakroom-rpc/acme/bin/certbot`. The script reuses the enclave's public CSR; the TLS private key never reaches Certbot.

Public traffic uses port 443. `GET /attestation?nonce=<32-byte hex>` binds a fresh Nitro quote to the TLS public-key hash, build and chain. Before publishing the wallet endpoint, verify it against an independently approved release:

```sh
pnpm --filter @cloakroom/attestation build
pnpm exec tsx services/rpc-gateway/scripts/verify-endpoint.ts <https-url> <trusted-release.json>
```

Adding the URL to MetaMask does not automatically verify that attestation. Browser Fetch cannot read the TLS peer certificate. No on-chain registry is required for this MVP.

Local tests cover successful signed broadcast/settlement on Anvil, TLS validation through a simulated Nox exit and the parent relay, sealing/restart, limits and cancellation. An unfunded Sepolia probe exercises the real Nox network without spending assets:

```sh
NOX_REGISTRY_RPC=<https-registry-chain-rpc> \
NOX_REGISTRY_ADDRESS=<registry-address> \
RPC_UPSTREAM_URL=<https-sepolia-rpc> \
pnpm exec tsx services/rpc-gateway/scripts/check-native-write.ts
```

Keep deployment configuration outside Git. Build with `services/rpc-gateway/Dockerfile` and `RPC_CONFIG_SHA256=<sha256 of exact config bytes>`. `nitro/gateway.py parent` runs the CID-restricted relays; only its certificate-control socket is bound to loopback. TLS terminates in the enclave, so a parent proxy must not terminate HTTPS. Deployment also requires a Nitro-enabled host, matching KMS policy and public DNS/certificate.

[Nox SDK](https://github.com/hisoka-io/nox-sdk) · [Anon-RPC native harness status](https://github.com/ethereum/anon-rpc/tree/main/impl/node-harness)
