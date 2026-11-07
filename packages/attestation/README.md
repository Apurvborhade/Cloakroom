# Nitro attestation verification

Browser-compatible WebCrypto verification of AWS Nitro COSE signatures, certificate chains anchored to the pinned AWS root, fresh challenge nonces, PCR0/1/2, build and key bindings. Debug measurements and stale quotes fail closed. No revocation service is queried.

`verifyCustodyAttestation(response, { release, nonce, escapeSigner? })` must complete before trusting `enclavePubKey`. Supply an independently trusted release containing `buildHash`, `chainId` and `measurements: { PCR0, PCR1, PCR2 }`; never derive that policy from the response being verified. Generate a fresh 32-byte nonce for each verification and send its hex encoding to `/attestation?nonce=…`. An escape-enabled deployment can additionally pin its signer address.

`verifyRpcAttestation(response, { release, nonce, expectedTlsSpkiSha256 })` binds the RPC quote to a TLS key. The expected SPKI hash must come from the actual TLS connection or a trusted pin. Standard browser Fetch cannot expose the peer certificate; the RPC gateway's `verify-endpoint.ts` performs that check in Node. MetaMask does not verify Nitro attestation when adding a custom network.

Certificate time and quote freshness depend on a correct local clock. Frontend integration remains a separate step; adding this package alone does not change the attestation badge.
