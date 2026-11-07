# API and signing

Every state-changing request is an EIP-712 message signed by the owner's wallet and encrypted to the enclave. This is what makes replays, tampered destinations and double spends testable.

Shared types live in `packages/shared`, so the browser signs exactly what the enclave verifies.

## EIP-712 messages

Price is a fixed-point number: tokenOut per 1 tokenIn in human units, multiplied by 1e18, so token decimals never leak into comparisons.

There is no `verifyingContract`, because there is no privacy contract. The `salt` is `keccak256(enclavePubKey)`, so signatures only verify against this enclave.

```ts
// packages/shared/src/eip712.ts
import type { Address, Hex } from 'viem';

export const NATIVE: Address = '0x0000000000000000000000000000000000000000';

export const domain = (chainId: number, enclaveKeyHash: Hex) =>
  ({ name: 'PrivateIntentNetwork', version: '1', chainId, salt: enclaveKeyHash }) as const;

export const types = {
  SessionGrant: [
    { name: 'owner', type: 'address' },
    { name: 'sessionKey', type: 'address' },
    { name: 'expiry', type: 'uint64' },
  ],
  SessionQuery: [
    { name: 'owner', type: 'address' },
    { name: 'expiry', type: 'uint64' },
  ],
  DepositRequest: [
    { name: 'owner', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  Intent: [
    { name: 'owner', type: 'address' },
    { name: 'tokenIn', type: 'address' },
    { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'comparator', type: 'uint8' },     // 0: price >= trigger, 1: price <= trigger
    { name: 'triggerPrice', type: 'uint256' }, // 1e18 fixed point
    { name: 'maxSlippageBps', type: 'uint16' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  CancelIntent: [
    { name: 'owner', type: 'address' },
    { name: 'intentId', type: 'bytes32' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  Withdrawal: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
} as const;
```

```ts
// packages/shared/src/schemas/api.ts
export type Envelope = { enc: string; ct: string }; // HPKE-sealed JSON, base64

export type SignedRequest<T> = { message: T; signature: Hex };

export type Balance = {
  token: Address;
  available: string; // base units as decimal strings
  reserved: string;
  pending: string;
};

export type IntentStatus =
  | 'pending' | 'executing' | 'done' | 'failed' | 'cancelled' | 'expired';

export type WithdrawalStatus =
  | 'locked' | 'sent' | 'confirmed' | 'failed';
```

## Rules for every signed message

- Recover the signer from the signature and require it to equal `owner` (or the granted session key for reads).
- **Expiry policy distinction:**
  - For mutating operations (`DepositRequest`, `Intent`, `CancelIntent`, `Withdrawal`) and read queries (`SessionQuery`), require `expiry` within at most 5 minutes ahead (`MAX_EXPIRY_FUTURE_SEC`) and at most 60 seconds of clock skew in the past (`MAX_CLOCK_SKEW_SEC`).
  - For `SessionGrant`, require `expiry` strictly in the future (`expiry > now`) and at most 30 minutes ahead (`SESSION_GRANT_TTL_SEC`). Clock skew into the past is not permitted for session grants.
- For mutating operations (`DepositRequest`, `Intent`, `CancelIntent`, `Withdrawal`), require `nonce` strictly greater than the owner's last accepted nonce (`nonce > lastNonce`), checked and written inside `FifoSerialQueue`. Because the default starting nonce is `0n`, the first valid user nonce is `1n` (or any `> 0n`).
- For `SessionQuery`, verify that a valid `SessionGrant` exists for `sessionKey`, matches `owner`, and has not expired. `SessionQuery` does not consume an owner nonce.
- Reject a domain `chainId` or `salt` that does not match.

**Session grants (saves wallet popups):** The user signs one `SessionGrant` for a browser-held key valid for 30 minutes (`SESSION_GRANT_TTL_SEC`). Balance and status reads are signed by that key. Deposits, intents, cancellations, and withdrawals always require a fresh primary wallet signature. Session grants are ephemeral in-memory records; restarting the enclave invalidates active session grants, requiring the client to request a fresh grant.

## Transport

Request bodies for POST endpoints are encrypted to the enclave's attested public key at the application layer using HPKE. The frontend shows the attestation measurement and a link to the reproducible build.

### HPKE parameters

`sealEnvelopeWithResponse` in `@cloakroom/shared` uses `@hpke/core` 1.10.0: DHKEM-X25519/HKDF-SHA256 (`0x0020`), HKDF-SHA256 (`0x0001`), AES-256-GCM (`0x0002`). Each request creates a fresh context with info `cloakroom/hpke/v1`. Use `sealEnvelope` when no private reply is needed.

Requests use `{ enc, ct }` with canonical padded base64 and UTF-8 JSON `[1, chainId, path, lowercaseEnclavePublicKeyHex]` as associated data. Allow 24 KiB for the wire body; enforce 16 KiB after decryption. Signature validation and nonce consumption remain mandatory.

Private POST success responses use `{ nonce, ct }`, both canonical padded base64. AES-256-GCM uses a 32-byte key exported with label `cloakroom/hpke/response/v1` and a fresh random 12-byte nonce for every reply, including repeated requests. Associated data is `response:` followed by the request's associated data. `ct` includes the 16-byte authentication tag; plaintext is capped at 16 KiB. Missing or modified nonces are rejected.

The server calls `keys.decryptWithResponse` then `sealResponse`; the client retains `openResponse` from `sealEnvelopeWithResponse`. Each closure is single-use. Response schemas below describe decrypted bodies. Mount this transport on all private routes; public GET responses and standard errors stay plaintext.

## Endpoints

All POST bodies are an `Envelope`: the inner JSON is sealed to the enclave public key with HPKE. Amounts are decimal strings in base units. Errors return `{ error: code }` with no detail about other users.

| Method and path | Inner request | Response body after opening |
| --- | --- | --- |
| `GET /attestation` | none | `{ quote, enclavePubKey, buildHash, chainId }` |
| `GET /sim/enclave-key` | none | `{ enclavePubKey, chainId, simulated: true }`. Only when `SIM_MODE=true`. The key is not attested, so show the TEE-simulated banner |
| `POST /session` | `SessionGrant` + wallet signature | `{ ok: true, expiresAt }` |
| `POST /deposit-session` | `DepositRequest` + signature | `{ sessionId, depositAddress, expiresAt, asset, gasReserveWei, singleUse: true }` |
| `POST /deposits/status` | `SessionQuery` + session signature | `{ deposits: [{ sessionId, depositAddress, expiresAt, asset, gasReserveWei, singleUse, status, nativeReceived, tokenReceived, nativeCredited, tokenCredited }] }` |
| `POST /balance` | `SessionQuery` + session signature | `{ balances: Balance[] }` |
| `POST /intents` | `Intent` + signature | `{ intentId, status: 'pending' }` |
| `POST /intents/status` | `SessionQuery` + session signature | `{ intents: [{ id, status, amountOut?, attempts?, reason? }] }` |
| `POST /intents/cancel` | `CancelIntent` + signature | `{ status: 'cancelled' }` |
| `POST /withdrawals` | `Withdrawal` + signature | `{ withdrawalId, status: 'locked' }` |
| `POST /withdrawals/status` | `SessionQuery` + session signature | `{ withdrawals: [{ id, status, txHash?, reason? }] }` |
| `GET /health/reconcile` | none | `{ ok, perToken: [{ token, onChain, claims }] }` |
| `POST /admin/eoas` | `AdminEoas` + admin signature | `{ addresses }` (one-time inventory disclosure) |

Reads signed by a session key answer `EXPIRED` if the query itself has expired, and `UNKNOWN_SESSION` for every other failure, including a wrong signature or a wrong session key. Anyone can send a query naming any owner, so different errors would reveal who has an active session. Session grants live in memory, so after a restart reads answer `UNKNOWN_SESSION` until the user signs a new grant.

`POST /intents` accepts only "price at or above" orders, from ETH to the configured output token, up to `MAX_AMOUNT_NATIVE_WEI`. These checks run before the nonce is spent. An expired order ends on its own and its funds are released. `POST /intents/cancel` answers `INTENT_NOT_FOUND` unless the order belongs to the signer and is still pending. `amountOut` in a status is what the owner was credited, after the fee.

`POST /withdrawals` accepts ETH, up to `MAX_AMOUNT_NATIVE_WEI`, and the configured output token. It answers once an address is assigned to pay it, so follow `POST /withdrawals/status` for the result. A result that isn't known yet stays `sent` until recovery settles it. Own deposit addresses are always excluded. Addresses without the owner's swap history are preferred; a prior swap address is a fallback, which can publicly link that swap to the payout. `NO_INVENTORY` means no eligible single address has enough funds and gas; the reservation is released.

Each `POST /deposit-session` allocates a new address. `pending` in a balance is always `0` for now, because deposits are credited only once confirmed.

`/health/reconcile` returns aggregates only, with no per-user data. Never return custody EOA addresses except the one assigned to a deposit session, and the one-time admin seeding call.

**Deposits:** Sign `DepositRequest.asset` as `NATIVE` or the configured `TOKEN_OUT_ADDRESS`. Send ETH, or USDC plus ETH, to the returned address. For every new session, `gasReserveWei` is retained for operations and is not credited as withdrawable ETH. ETH above that reserve is credited; USDC is credited in full once both transfers are confirmed, in either order. Display the reserve before funding.

Each new address is single-use: completion credits both assets atomically and immediately makes the address available for other owners. Stop sending to it after completion; obtain a new session for another deposit. An empty session expires at `expiresAt`. A partial deposit received before that deadline stays pending, including across restarts, until its missing ETH or USDC arrives. Existing sessions opened before this feature retain their original ETH-only behavior.

Poll `/deposits/status` for `awaiting_funds`, `awaiting_gas`, `awaiting_token`, `credited`, or `expired`. Received amounts are observed at the configured confirmation depth; credited amounts exclude the gas reserve. Pending deposits are reported here, not in `/balance.pending`. Only the authenticated owner's sessions are returned.

### Attestation response (Nitro, phase 0)

`GET /attestation` returns `{ quote, enclavePubKey, buildHash, chainId }`:

- `quote`: base64-encoded CBOR/COSE Sign1 Nitro attestation document.
- `enclavePubKey`: `0x`-prefixed hex raw 32-byte X25519 public key, generated inside the enclave.
- `buildHash`: `0x`-prefixed lowercase hex SHA-256 build hash.
- `chainId`: `11155111` (Sepolia).

For freshness, supply `?nonce=<hex>` with 32–64 random bytes encoded as lowercase hex. The document signs that nonce, the raw public key in `public_key`, and `sha256(rawPublicKey || rawBuildHash)` in `user_data`. Decode the build hash from hex before concatenation. Verify against trusted PCR0–2 from the build, not just the response's build hash. The attestation-only bootstrap key changes on restart. Custody attestation uses the sealed `KeyManager` identity, which survives state restoration. A new vault rotates the key and EIP-712 domain salt.

With escape protection enabled, the response also contains `escapeSigner`. Its binding is `sha256(UTF8("cloakroom/attestation/escape/v1\0") || rawPublicKey || rawBuildHash || rawEscapeSigner)`, where the last field is 20 bytes. Use `scripts/verify-attestation.py --escape-signer <address>` with trusted measurements to check the contract's signer. Publishing this response on-chain would not by itself verify it.

### ETH escape hatch (optional)

Enabled by `ESCAPE_HATCH_ADDRESS`. It covers one fixed ETH amount from the separate contract reserve. Activation requires the entire available ETH balance, closed deposit sessions, no other token balance or reservations, and no spot-intent, lending or margin history. The amount stays reserved through restarts and cannot be withdrawn or traded normally. Later deposits are not added to the claim.

| Endpoint | Authentication | Response |
| --- | --- | --- |
| `GET /escape/identity` | Public, including before configuration | `{ escapeSigner, chainId, enabled, unverified: true }`; a deployment hint, not an attestation |
| `POST /escape/activate` | Owner signs `EIP712_TYPES.EscapeActivate`; HPKE envelope | `{ claim }` after reserving the balance; poll for registration |
| `POST /escape/status` | Encrypted `SessionQuery` | `{ claim, hatch, escapeSigner, expired, lastHeartbeat, timeout }` |

Generate and save a random 32-byte `code` before activation. Compute `claimId` with `escapeClaimId(chainId, hatch, owner, code)` from `@cloakroom/shared`. The activation plaintext is `{ message: { owner, hatch, claimId, amount, nonce, expiry }, signature, code }`; integer fields use decimal strings. The code is checked against the signed claim ID and then discarded, never journaled.

Activation may return `ESCAPE_INELIGIBLE`, `ESCAPE_ALREADY_REGISTERED` or `ESCAPE_UNAVAILABLE` (exported as `ESCAPE_ERROR_CODES`). There is no deactivation or code replacement.

Claim status is `reserved`, `broadcast`, `registered`, `failed` or `claimed`; records include the amount and, when available, the transaction hash or failure reason. Show protection as active only at `registered`. An uncertain transaction keeps the funds reserved. After the contract timeout, the same owner wallet calls `claim(code)` through Etherscan or another client using an independent RPC. The wallet needs gas. This path needs neither the application nor a fresh enclave signature. Registration amounts and claims are public. See [contract instructions](../contracts/README.md).

### Example: create an intent (inner JSON before sealing)

```json
{
  "message": {
    "owner": "0xAlice...",
    "tokenIn": "0x0000000000000000000000000000000000000000",
    "tokenOut": "0xUSDC...",
    "amountIn": "100000000000000000",
    "comparator": 0,
    "triggerPrice": "3000000000000000000000",
    "maxSlippageBps": 50,
    "nonce": "7",
    "expiry": "1790000000"
  },
  "signature": "0x..."
}
```

This authorizes selling 0.1 ETH for at least 300 USDC credited after the protocol fee. Slippage may reduce the current quote by at most 0.5%, but cannot reduce that net minimum. Only comparator 0 is executable in the demo. Close to the limit, the public transaction minimum can reveal the limit price.

## Error codes

`BAD_SIGNATURE`, `EXPIRED`, `NONCE_USED`, `WRONG_CHAIN`, `INSUFFICIENT_BALANCE`, `NO_INVENTORY`, `UNKNOWN_SESSION`, `UNSUPPORTED_ASSET`, `UNAUTHORIZED`, `INTENT_NOT_FOUND`, `INVALID_PAYLOAD`, `INTERNAL_ERROR`

## Server hardening

- Body size limit: 24 KiB on the wire, 16 KiB after decryption
- Zod validation on decrypted JSON
- A per-IP rate limit
- CORS restricted to `ALLOWED_ORIGIN`
- Logs exclude keys, seeds, addresses, amounts and intent contents


### Admin seeding contract

`POST /admin/eoas` takes `{ enc, ct }` from `sealEnvelopeWithResponse`. Its plaintext is `{ message: { admin, nonce, expiry }, signature }`; nonce and expiry are uint64 decimal strings. Sign `EIP712_TYPES.AdminEoas` with the usual chain/key domain. Expiry must be current and at most 300 seconds ahead.

Success uses the encrypted response format above. `openResponse` returns `{ addresses }`, containing at most 128 inventory addresses. Standard errors contain no addresses.

The route is absent when seeding is disabled. Once disclosure is durably consumed, further authorized calls return `403 UNAUTHORIZED`, including after restart. Do not log requests or responses. A lost response does not automatically reopen disclosure.
