# Oracle body format

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Shreyas, Pradnyesh | Phase 2 |

## Problem

The spec says all POST bodies are an Envelope, but the CRE sketch posts a plain report with an HMAC of the body.

## Proposal

Exempt `/oracle/price` from sealing, since prices are not private.
