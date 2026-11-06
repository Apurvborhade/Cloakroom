# Admin EOAs endpoint

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | TEE, API | Phase 1 |

## Decision

`POST /admin/eoas` accepts an HPKE envelope containing a signed EIP-712 `AdminEoas` message: `admin`, `nonce`, `expiry`. The domain uses the configured chain and attested key salt. Only `ADMIN_ADDRESS` is accepted, with an expiry no more than five minutes ahead.

Mount `custodyRoutes` with `seedingEnabled: true` during initial funding. The route returns inventory addresses only, in an authenticated encrypted response derived from the request's HPKE exporter secret. The client uses `sealEnvelopeWithResponse` and its `openResponse` closure. A parent cannot substitute funding addresses or decrypt the response.

`KeyManager` durably consumes disclosure before returning addresses. Concurrent calls and restarts cannot reopen it. An interrupted response may consume the call without delivering addresses; recovery requires an explicit maintenance procedure. Setting `SEEDING_ENABLED=false` omits the route entirely. No private keys, deposit allocations or request bodies belong in logs.

## Integration

The plugin is available independently of the application server. The API workstream must mount it after opening the sealed state. Restore rollback protection needs an external trusted checkpoint; rolling back all storage together is outside the current guarantee.
