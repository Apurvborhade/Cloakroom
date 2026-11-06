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
- Require `expiry` in the future and at most 5 minutes ahead (`MAX_EXPIRY_FUTURE_SEC`), with at most 60 seconds of clock skew (`MAX_CLOCK_SKEW_SEC`).
- For mutating operations (`DepositRequest`, `Intent`, `CancelIntent`, `Withdrawal`), require `nonce` strictly greater than the owner's last accepted nonce, checked and written inside `FifoSerialQueue`.
- For `SessionQuery`, verify that a valid `SessionGrant` exists for `sessionKey`, matches `owner`, and has not expired. `SessionQuery` does not consume an owner nonce.
- Reject a domain `chainId` or `salt` that does not match.

**Session grants (saves wallet popups):** The user signs one `SessionGrant` for a browser-held key valid for 30 minutes (`SESSION_GRANT_TTL_SEC`). Balance and status reads are signed by that key. Deposits, intents, cancellations, and withdrawals always require a fresh primary wallet signature.

## Transport

Request bodies for POST endpoints are encrypted to the enclave's attested public key at the application layer using HPKE. The frontend shows the attestation measurement and a link to the reproducible build.

## Endpoints

All POST bodies are an `Envelope`: the inner JSON is sealed to the enclave public key with HPKE. Amounts are decimal strings in base units. Errors return `{ error: code }` with no detail about other users.

| Method and path | Inner request | Response |
| --- | --- | --- |
| `GET /attestation` | none | `{ quote, enclavePubKey, buildHash, chainId }` |
| `POST /session` | `SessionGrant` + wallet signature | `{ ok: true, expiresAt }` |
| `POST /deposit-session` | `DepositRequest` + signature | `{ sessionId, depositAddress, expiresAt }` |
| `POST /balance` | `SessionQuery` + session signature | `{ balances: Balance[] }` |
| `POST /intents` | `Intent` + signature | `{ intentId, status: 'pending' }` |
| `POST /intents/status` | `SessionQuery` + session signature | `{ intents: [{ id, status, amountOut? }] }` |
| `POST /intents/cancel` | `CancelIntent` + signature | `{ status: 'cancelled' }` |
| `POST /withdrawals` | `Withdrawal` + signature | `{ withdrawalId, status: 'locked' }` |
| `POST /withdrawals/status` | `SessionQuery` + session signature | `{ withdrawals: [{ id, status, txHash?, reason? }] }` |
| `GET /health/reconcile` | none | `{ ok, perToken: [{ token, onChain, claims }] }` |
| `POST /admin/eoas` | Admin-signed POST request | `{ eoas: [{ address, role }] }` (disabled if `SEEDING_ENABLED=false`) |

`/health/reconcile` returns aggregates only, with no per-user data. Never return custody EOA addresses except the one assigned to a deposit session, and the one-time admin seeding call.

### Attestation response (Nitro, phase 0)

`GET /attestation` returns `{ quote, enclavePubKey, buildHash, chainId }`:

- `quote`: base64-encoded CBOR/COSE Sign1 Nitro attestation document.
- `enclavePubKey`: base64-encoded raw 32-byte X25519 public key, generated inside the enclave.
- `buildHash`: lowercase hex SHA-256 build hash.
- `chainId`: `11155111` (Sepolia).

For freshness, supply `?nonce=<hex>` with 32–64 random bytes encoded as lowercase hex. The document signs that nonce, the raw public key in `public_key`, and `sha256(rawPublicKey || rawBuildHash)` in `user_data`. Decode the build hash from hex before concatenation. Verify against trusted PCR0–2 from the build, not just the response's build hash. The phase-0 key changes on restart; clients must fetch attestation again. Key persistence is still tracked in gap 3.6.

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

`BAD_SIGNATURE`, `EXPIRED`, `NONCE_USED`, `WRONG_CHAIN`, `INSUFFICIENT_BALANCE`, `NO_INVENTORY`, `UNKNOWN_SESSION`, `UNSUPPORTED_ASSET`, `UNAUTHORIZED`, `INTENT_NOT_FOUND`, `INVALID_PAYLOAD`, `INTERNAL_ERROR`

## Server hardening

- Body size limit: 16 KB (`MAX_BODY_SIZE_BYTES`)
- Zod validation on decrypted JSON
- Per-IP rate limiting
- CORS restricted to `ALLOWED_ORIGIN`
- Structured logs that never contain private keys, seed phrases, user balances, or intent parameters
