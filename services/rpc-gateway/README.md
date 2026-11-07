# RPC gateway prototype

A separate HTTPS JSON-RPC server that accepts wallet-signed `eth_sendRawTransaction` and common wallet reads. It has no wallet keys, custody access or escape-hatch heartbeat. Signing/admin methods are refused. Requests, responses, concurrency and timeouts are bounded; a timed-out broadcast is never retried automatically. The server does not log request payloads or client addresses.

`createRpcGateway({ tls, transport })` requires an explicitly supplied transport. `createFetchTransport(url, anonymousFetch)` adapts an anonymous fetch; it has no direct-fetch fallback. Supplying ordinary fetch does **not** make traffic anonymous.

TLS terminates in this server. A future Nitro deployment must generate/seal its TLS private key inside the enclave and bind `tlsSpkiSha256(cert)` to a verified fresh attestation. The parent must forward TCP without terminating TLS. These deployment and verification steps are not implemented here. Adding a custom RPC URL to MetaMask does not itself verify Nitro attestation.

The existing Anon-RPC harness needs a browser sandbox and WebRTC. Its native Node/Nitro adapter is still missing. The external compatibility probe below runs the existing browser harness in Playwright, outside the custody service; Chromium is not an enclave runtime dependency.

```sh
pnpm exec tsc -p services/rpc-gateway/tsconfig.json --noEmit
pnpm exec vitest run --project backend services/rpc-gateway/test

ANON_RPC_SPECIFIER=<network-specifier-address> \
ANON_RPC_BOOTSTRAP_URL=<https-rpc-for-specifier-chain> \
ANON_RPC_TARGET_URL=<https-sepolia-rpc> \
pnpm exec tsx services/rpc-gateway/scripts/check-anon-write.ts
```

The probe verifies a worker bundle through the harness, reads Sepolia through the injected transport, and submits a newly generated, unfunded account's signed transaction. Success means the upstream rejects it for insufficient funds; no assets are spent. It requires installed Playwright Chromium and an operational anonymous network. `ANON_RPC_WORKER_CONFIG` optionally supplies that network's JSON configuration. Keep credentialed endpoints out of Git and shared output.

The local Anvil tests separately verify successful broadcast and settlement through the TLS gateway. They use a direct transport explicitly and make no anonymity claim. Neither test establishes deployed Nitro attestation or MetaMask UI compatibility.

[Anon-RPC browser integration](https://github.com/ethereum/anon-rpc/blob/main/docs/integrate-wallet.md) · [Network deployments](https://github.com/ethereum/anon-rpc/blob/main/adopters.json5)
