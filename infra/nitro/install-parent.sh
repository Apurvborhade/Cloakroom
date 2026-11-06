#!/usr/bin/env bash
set -euo pipefail

# Installs reviewed artifacts and units. Starting/replacing an enclave is a separate step.
release_dir=${1:?Usage: install-parent.sh /absolute/release REGION}
aws_region=${2:?Usage: install-parent.sh /absolute/release REGION}
[[ $EUID -eq 0 ]] || { printf '%s\n' 'Run as root on the Nitro parent.' >&2; exit 1; }
[[ "$aws_region" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]] || exit 1
release_id=$(python3 - "$release_dir" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys

directory = Path(sys.argv[1])
assert directory.is_absolute()
manifest = json.loads((directory / "release.json").read_text())
digest = hashlib.sha256()
with (directory / "attestation.eif").open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
assert re.fullmatch(r"[a-f0-9]{64}", manifest["eifSha256"])
assert digest.hexdigest() == manifest["eifSha256"]
assert manifest["architecture"] == "arm64"
print(manifest["eifSha256"])
PY
)
target=/opt/cloakroom/releases/$release_id
install -d -m 0755 "$target" /opt/cloakroom/nitro /etc/cloakroom
install -m 0444 "$release_dir/attestation.eif" "$target/attestation.eif"
install -m 0444 "$release_dir/release.json" "$target/release.json"
install -m 0444 services/enclave/nitro/*.py /opt/cloakroom/nitro/
install -m 0644 infra/nitro/cloakroom-*.service /etc/systemd/system/
if [[ ! -e /etc/cloakroom/parent.env ]]; then
  printf 'ENCLAVE_CID=16\nENCLAVE_MEMORY=2048\nAWS_REGION=%s\n' "$aws_region" > /etc/cloakroom/parent.env
  chmod 0600 /etc/cloakroom/parent.env
fi
ln -sfn "$target" /opt/cloakroom/current
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/cloakroom-*.service
printf '%s\n' 'Installed verified release and service units. Verify allocator settings before starting.'
