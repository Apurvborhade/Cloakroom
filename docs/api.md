# API and signing

Every state-changing request is an EIP-712 message signed by the owner's wallet and encrypted to the enclave. This is what makes replays, tampered destinations and double spends testable.

Shared types live in `packages/shared`, so the browser signs exactly what the enclave verifies.

## EIP-712 messages

Price is a fixed-point number: tokenOut per 1 tokenIn in human units, multiplied by 1e18, so token decimals never leak into comparisons.

There is no `verifyingContract`, because there is no privacy contract. The `salt` is a hash of the enclave public key, so signatures only verify against this enclave.

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

Types for session-signed reads and intent cancellation are not defined yet: see [missing EIP-712 types](decisions/2026-11-06-0151-missing-eip712-types.md).

```ts
// packages/shared/src/api.ts
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
```

## Rules for every signed message

- Recover the signer from the signature and require it to equal `owner` (or the granted session key for reads).
- Require `expiry` in the future and at most 5 minutes ahead, with at most 60 seconds of clock skew.
- Require `nonce` greater than the owner's last accepted nonce, checked and written inside the serialized ledger queue.
- Reject a domain `chainId` or `salt` that does not match.

**Session grants (optional, saves wallet popups):** the user signs one SessionGrant for a browser-held key valid for about 30 minutes. Balance and status reads are signed by that key. Deposits, intents and withdrawals always need a fresh wallet signature.

## Transport

TLS may terminate outside the enclave on some platforms, so request bodies are encrypted to the enclave's attested public key at the application layer. The frontend shows the attestation measurement and a link to the reproducible build. Full in-browser quote verification is a stretch goal; a CLI check is the minimum.

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
| `POST /session` | `SessionGrant` + wallet signature | `{ ok: true, expiresAt }` |
| `POST /deposit-session` | `DepositRequest` + signature | `{ sessionId, depositAddress, expiresAt }` |
| `POST /balance` | session-signed query | `{ balances: Balance[] }` |
| `POST /intents` | `Intent` + signature | `{ intentId, status: 'pending' }` |
| `POST /intents/status` | session-signed query | `{ intents: [{ id, status, amountOut? }] }` |
| `POST /intents/cancel` | `{ intentId }` + signature | `{ status: 'cancelled' }` |
| `POST /withdrawals` | `Withdrawal` + signature | `{ withdrawalId, status: 'locked' }` |
| `GET /health/reconcile` | none | `{ ok, perToken: [{ token, onChain, claims }] }` |
| `/admin/eoas` | signed admin call | Inventory EOA addresses, once. Disabled afterwards ([decision](decisions/2026-11-06-0151-admin-eoas-endpoint.md)) |

`/health/reconcile` returns aggregates only, with no per-user data. Never return custody EOA addresses except the one assigned to a deposit session, and the one-time admin seeding call.

### Attestation response (Nitro, phase 0)

`GET /attestation` returns `{ quote, enclavePubKey, buildHash, chainId }`:

- `quote`: base64-encoded CBOR/COSE Sign1 Nitro attestation document.
- `enclavePubKey`: `0x`-prefixed hex raw 32-byte X25519 public key, generated inside the enclave.
- `buildHash`: `0x`-prefixed lowercase hex SHA-256 build hash.
- `chainId`: `11155111` (Sepolia).

For freshness, supply `?nonce=<hex>` with 32–64 random bytes encoded as lowercase hex. The document signs that nonce, the raw public key in `public_key`, and `sha256(rawPublicKey || rawBuildHash)` in `user_data`. Decode the build hash from hex before concatenation. Verify against trusted PCR0–2 from the build, not just the response's build hash. The attestation-only bootstrap key changes on restart. Custody attestation uses the sealed `KeyManager` identity, which survives state restoration. A new vault rotates the key and EIP-712 domain salt.

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

This reads as: swap 0.1 ETH for USDC once ETH is at or above 3,000 USDC, accept at most 0.5% slippage.

## Error codes

`BAD_SIGNATURE`, `EXPIRED`, `NONCE_USED`, `WRONG_CHAIN`, `INSUFFICIENT_BALANCE`, `NO_INVENTORY`, `UNKNOWN_SESSION`

## Server hardening

- Body size limit (for example 16 KB)
- zod validation on the decrypted JSON
- A per-IP rate limit
- CORS limited to the frontend origin
- Structured logs that never contain addresses, amounts or intent contents


### Admin seeding contract

`POST /admin/eoas` takes `{ enc, ct }` from `sealEnvelopeWithResponse`. Its plaintext is `{ message: { admin, nonce, expiry }, signature }`; nonce and expiry are uint64 decimal strings. Sign `EIP712_TYPES.AdminEoas` with the usual chain/key domain. Expiry must be current and at most 300 seconds ahead.

Success uses the encrypted response format above. `openResponse` returns `{ addresses }`, containing at most 128 inventory addresses. Standard errors contain no addresses.

The route is absent when seeding is disabled. Once disclosure is durably consumed, further authorized calls return `403 UNAUTHORIZED`, including after restart. Do not log requests or responses. A lost response does not automatically reopen disclosure.
