#!/usr/bin/env bash
set -euo pipefail

# Run at the repository root on the ARM64 Nitro parent. Output stays outside Git.
output=${1:-/tmp/cloakroom-release}
tag=${2:-cloakroom-attestation:release}
case "$output" in /*) ;; *) printf '%s\n' 'Use an absolute output directory.' >&2; exit 1 ;; esac
if [[ $(uname -m) != aarch64 ]]; then
  printf '%s\n' 'Build on an ARM64 host to match the selected Nitro instance.' >&2
  exit 1
fi
mkdir -p "$output"
docker build -f services/enclave/Dockerfile -t "$tag" .
docker run --rm --entrypoint node "$tag" --input-type=module -e \
  'await import("./dist/nitro-custody.js"); await import("./dist/custody-routes.js"); await (await import("./dist/custody-selftest.js")).runCustodySelfTest(); console.log("CUSTODY_SELF_TEST_PASSED")'
nitro-cli build-enclave --docker-uri "$tag" --output-file "$output/attestation.eif" > "$output/measurements.json"
docker image inspect --format '{{.Id}}' "$tag" > "$output/docker-image-id"
docker run --rm --entrypoint cat "$tag" /app/dist/build-hash > "$output/build-hash"
python3 - "$output" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

directory = Path(sys.argv[1])
digest = hashlib.sha256()
with (directory / "attestation.eif").open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
manifest = {
    "architecture": "arm64", "entrypoint": "attestation-bootstrap",
    "liveCustodyEnabled": False,
    "dockerImageId": (directory / "docker-image-id").read_text().strip(),
    "buildHash": (directory / "build-hash").read_text().strip(),
    "eifSha256": digest.hexdigest(),
    "measurements": json.loads((directory / "measurements.json").read_text())["Measurements"],
}
(directory / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Release manifest created. Verify a fresh quote after non-debug launch.")
PY
