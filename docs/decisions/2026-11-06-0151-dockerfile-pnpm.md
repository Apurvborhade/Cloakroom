# Dockerfile and pnpm

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Felix | Phase 0 |

## Problem

The Dockerfile will likely not run. It copies only the root `node_modules` from a pnpm workspace, where package dependencies live under `services/enclave/node_modules` as symlinks.

## Proposal

Use `pnpm deploy` to produce a self-contained output directory, and test the image early.

## Phase-0 result

The attestation-only Docker image builds and runs in Nitro. Its runtime uses only Node built-ins and does not copy workspace `node_modules`. The full application still needs self-contained packaging when its entrypoint and dependencies are included.
