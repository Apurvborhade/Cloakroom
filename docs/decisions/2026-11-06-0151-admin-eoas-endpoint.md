# Admin EOAs endpoint

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Felix, Shreyas | Phase 1 |

## Problem

Prior to the hackathon demo, the custody inventory EOAs must be pre-funded with ETH and token inventory so swaps and withdrawals succeed immediately. The operator needs the derived EOA addresses from the enclave without compromising security.

## Existing behavior

The endpoint `/admin/eoas` was mentioned in `docs/api.md` without authentication or payload specifics.

## Decision

1. **Path & Method:** `POST /admin/eoas`.
2. **Access Control:**
   - Evaluated against `ADMIN_ADDRESS` and `SEEDING_ENABLED` in `EnclaveConfig`.
   - If `SEEDING_ENABLED === false`, the endpoint immediately returns 404 or 403 `UNAUTHORIZED`.
   - The request must be an EIP-712 or signed message from `ADMIN_ADDRESS`.
3. **Response:**
   ```ts
   {
     eoas: Array<{
       address: Address;
       role: 'deposit' | 'inventory';
     }>
   }
   ```
4. **No Private Key Leakage:** Returns public Ethereum addresses only. Seed words and private keys never leave `KeyManager`.

## Consequences

- Secure mechanism for initial inventory funding.
- Endpoint is permanently disabled in production by setting `SEEDING_ENABLED=false`.
