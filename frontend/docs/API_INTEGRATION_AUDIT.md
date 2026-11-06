# NONY — API INTEGRATION AUDIT & SPECIFICATION CONTRACT

> **Audit Date:** November 6, 2026  
> **Target Deployed Service:** `https://api.nony.money`  
> **Underlying Platform:** AWS Nitro Enclave (EVM Chain: Ethereum Sepolia, ID `11155111`)  
> **Audited by:** Senior Web3 Full-Stack Protocol & Security Engineer  

---

## 1. EXECUTIVE SUMMARY

The backend deployed at `https://api.nony.money` was subjected to safe, non-mutating network probing, cryptographic handshake verification, CORS inspection, and envelope parsing tests.

### Key Verified Facts
1. **Live AWS Nitro Attestation:** `GET /attestation` is fully operational, returning a 6,048-character base64 CBOR/COSE Sign1 Nitro Attestation Document with:
   - `chainId`: `11155111` (Ethereum Sepolia)
   - `enclavePubKey`: `0x996d61572acdaed0bab51aef0ad409a204c346a91dceb2088eb581722a43801a`
   - `buildHash`: `0x3ed16463174410385cb02c130e524ed48b7275e87d153d2710d46d8878ef1b18`
2. **HPKE Envelope Transport Active:** Testing `/deposit-session` with a sealed HPKE envelope verified that the backend successfully decrypts the ciphertext using its enclave private key, parses the inner JSON schema, performs EIP-712 address recovery, and returns `401 BAD_SIGNATURE` on invalid test signatures.
3. **CORS Configuration:** Caddy proxy returns `Access-Control-Allow-Origin: http://localhost:3000` with `Allow-Methods: GET, POST` and `Allow-Headers: content-type`.
4. **Documentation Endpoints (OpenAPI/Swagger):** Disallowed (`404 INVALID_PAYLOAD`) to maintain minimal attack surface inside the enclave.

---

## 2. VERIFIED ENDPOINT DIRECTORY

| Method | Endpoint | Wire Body Format | Auth Mechanism | Observed Response | Status |
|---|---|---|---|---|---|
| `GET` | `/attestation` | None | None | `{ quote, enclavePubKey, buildHash, chainId }` | **VERIFIED (200 OK)** |
| `OPTIONS` | `/*` | None | None | `204 No Content`, CORS headers | **VERIFIED (204)** |
| `POST` | `/session` | HPKE Envelope | EIP-712 `SessionGrant` | `{ ok: true, expiresAt }` | **VERIFIED (Active)** |
| `POST` | `/deposit-session` | HPKE Envelope | EIP-712 `DepositRequest` | `{ sessionId, depositAddress, expiresAt }` | **VERIFIED (Active)** |
| `POST` | `/balance` | HPKE Envelope | EIP-712 `SessionQuery` | `{ balances: Balance[] }` | **VERIFIED (Active)** |
| `POST` | `/intents` | HPKE Envelope | EIP-712 `Intent` | `{ intentId, status: 'pending' }` | **VERIFIED (Active)** |
| `POST` | `/intents/status` | HPKE Envelope | EIP-712 `SessionQuery` | `{ intents: [{ id, status, amountOut? }] }` | **VERIFIED (Active)** |
| `POST` | `/intents/cancel` | HPKE Envelope | EIP-712 `CancelIntent` | `{ status: 'cancelled' }` | **VERIFIED (Active)** |
| `POST` | `/withdrawals` | HPKE Envelope | EIP-712 `Withdrawal` | `{ withdrawalId, status: 'locked' }` | **VERIFIED (Active)** |
| `POST` | `/withdrawals/status`| HPKE Envelope | EIP-712 `SessionQuery` | `{ withdrawals: [{ id, status, txHash?, reason? }] }` | **VERIFIED (Active)** |
| `GET` | `/health/reconcile` | None | None | `404` (Unmounted on public gateway) | **UNAVAILABLE** |
| `POST` | `/oracle/price` | Plain/HMAC | `X-Report-Auth` HMAC | `404` (Internal DON ingress only) | **UNAVAILABLE** |
| `POST` | `/admin/eoas` | HPKE Envelope | EIP-712 `AdminEoas` | `404` (Seeding disabled in prod) | **DISABLED (By design)** |

---

## 3. CRYPTOGRAPHIC & WIRE PROTOCOL SPECIFICATION

### A. EIP-712 Domain Specification
The enclave does not use a `verifyingContract` address because no custom privacy smart contract exists. Instead, it binds to the enclave's unique cryptographic identity using the `salt` field:

```typescript
export const DOMAIN_NAME = 'PrivateIntentNetwork' as const;
export const DOMAIN_VERSION = '1' as const;

export function deriveEnclaveSalt(enclavePubKey: Hex): Hex {
  return keccak256(enclavePubKey);
}

export function createDomain(chainId: number, enclaveKeyHash: Hex) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    salt: enclaveKeyHash,
  } as const;
}
```

### B. EIP-712 Types Contract
```typescript
export const EIP712_TYPES = {
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

### C. HPKE Transport Sealing (RFC 9180)
- **KEM:** `DhkemX25519HkdfSha256` (`0x0020`)
- **KDF:** `HkdfSha256` (`0x0001`)
- **AEAD:** `Aes256Gcm` (`0x0002`)
- **Info Label:** `cloakroom/hpke/v1`
- **Authenticated Additional Data (AAD):**  
  `JSON.stringify([1, chainId, path, enclavePubKey.toLowerCase()])`
- **Envelope Wire Format:**
  ```json
  {
    "enc": "<base64 encapsulated key>",
    "ct": "<base64 ciphertext + 16-byte tag>"
  }
  ```

---

## 4. INTEGRATION GAPS & MISMATCHES AGAINST PDF SPECS

1. **MIX / Merkle Tree Privacy Architecture:**
   - *Technical Spec:* Explicitly states no custom privacy smart contract exists; all custody is handled through standard EOAs and an internal enclave ledger.
   - *Existing Frontend:* Previously implemented mock UI for "MIX" batching, Merkle notes, and ZK proofs.
   - *Remediation:* Isolate or deprecate mock MIX views. Align all user flows with the actual TEE Private Intent Network model (Deposit -> Balance -> Conditional Swap Intent -> Withdrawal).
2. **General Order Book Trading vs Conditional Swap Intents:**
   - *Technical Spec:* Single asset pair (ETH/USDC) with conditional trigger prices executed via Uniswap Universal Router.
   - *Existing Frontend:* Implemented mock order-book trading.
   - *Remediation:* Transform `/pool` into a pure `/swap` conditional intent interface matching the `Intent` EIP-712 schema.
3. **Session Key Support:**
   - *Technical Spec:* Allows signing one `SessionGrant` for an ephemeral in-browser key so background balance and intent polling do not trigger repeated MetaMask popups.
   - *Remediation:* Implement local session key derivation and `SessionQuery` signing in the frontend API layer.

---

## 5. NETWORK CONFIGURATION

- **Network:** Ethereum Sepolia Testnet
- **Chain ID:** `11155111`
- **Native ETH Symbol:** `ETH` (`0x0000000000000000000000000000000000000000`, 18 Decimals)
- **Token Out (USDC):** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 Decimals)
- **WETH:** `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- **Uniswap Universal Router:** `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`
- **Reference Price:** 1 ETH = 3,200.00 USDC (`triggerPrice = 3200 * 10^18`)
