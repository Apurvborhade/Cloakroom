# Oracle body format

| Status | Owner | Needed by |
| --- | --- | --- |
| Superseded by [Drop Chainlink CRE](2026-11-06-0358-drop-chainlink-cre.md) | Shreyas, Pradnyesh | Settled |

## Problem

The spec says all POST bodies are an Envelope, but the CRE sketch posts a plain report with an HMAC of the body.

## Proposal

Exempt `/oracle/price` from sealing, since prices are not private.
