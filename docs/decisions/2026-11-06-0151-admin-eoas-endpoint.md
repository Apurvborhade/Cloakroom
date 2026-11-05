# Admin EOAs endpoint

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Felix, Shreyas | Phase 1 |

## Problem

`/admin/eoas` is not in the spec's API table, and its auth is only described as "a signed admin call".

## Proposal

Make it a POST signed by `ADMIN_ADDRESS`, disabled by `SEEDING_ENABLED=false`. It is listed in [api.md](../api.md).
