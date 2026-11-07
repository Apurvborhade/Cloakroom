#!/usr/bin/env bash
set -euo pipefail

stop() { nitro-cli terminate-enclave --enclave-name cloakroom-rpc >/dev/null 2>&1 || true; }
trap stop EXIT
trap 'exit 0' TERM INT
nitro-cli run-enclave --cpu-count 1 --memory 2048 --enclave-cid 18 \
  --enclave-name cloakroom-rpc --eif-path /opt/cloakroom-rpc/current/rpc.eif
while nitro-cli describe-enclaves | python3 -c \
  'import json,sys; sys.exit(not any(e.get("EnclaveName")=="cloakroom-rpc" and e.get("State")=="RUNNING" for e in json.load(sys.stdin)))'; do
  sleep 10
done
exit 1
