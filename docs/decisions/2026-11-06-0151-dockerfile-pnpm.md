# Dockerfile and pnpm

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Felix | Phase 0 |

## Problem

The Dockerfile will likely not run. It copies only the root `node_modules` from a pnpm workspace, where package dependencies live under `services/enclave/node_modules` as symlinks.

## Proposal

Use `pnpm deploy` to produce a self-contained output directory, and test the image early.
