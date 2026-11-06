#!/usr/bin/env bash
set -euo pipefail

# Run at the repository root on the ARM64 Nitro parent. Output stays outside Git.
output=${1:-/tmp/cloakroom-release}
tag=${2:-cloakroom-attestation:release}
config_file=${3:-}
case "$output" in /*) ;; *) printf '%s\n' 'Use an absolute output directory.' >&2; exit 1 ;; esac
if [[ $(uname -m) != aarch64 ]]; then
  printf '%s\n' 'Build on an ARM64 host to match the selected Nitro instance.' >&2
  exit 1
fi
mkdir -p "$output"
config_hash=''
if [[ -n "$config_file" ]]; then
  config_hash=$(python3 - "$config_file" <<'PY'
import hashlib, json, stat, sys
from pathlib import Path

path = Path(sys.argv[1]).resolve()
assert not path.is_relative_to(Path.cwd().resolve()), "Keep configuration outside the repository"
info = path.stat()
assert stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, "Private configuration requires mode 0600"
assert info.st_size <= 65536, "Configuration too large"
data = path.read_bytes()
values = json.loads(data)
assert isinstance(values, dict) and all(isinstance(v, str) for v in values.values()), "Expected a JSON object of strings"
assert values.get("SIM_MODE") == "false", "Nitro requires SIM_MODE=false"
print(hashlib.sha256(data).hexdigest())
PY
)
fi
docker build --build-arg "NITRO_CONFIG_SHA256=$config_hash" -f services/enclave/Dockerfile -t "$tag" .
docker run --rm --entrypoint node "$tag" --input-type=module -e \
  'const fs = await import("node:fs");
   const expected = process.argv[1], path = "./dist/config.sha256";
   if (fs.existsSync(path) !== Boolean(expected) || (expected && fs.readFileSync(path, "utf8").trim() !== expected))
     throw new Error("CONFIG_COMMITMENT_MISMATCH");
   await import("./dist/nitro-custody.js"); await import("./dist/custody-routes.js");
   await (await import("./dist/custody-selftest.js")).runCustodySelfTest(); console.log("CUSTODY_SELF_TEST_PASSED")' "$config_hash"
nitro-cli build-enclave --docker-uri "$tag" --output-file "$output/attestation.eif" > "$output/measurements.json"
docker image inspect --format '{{.Id}}' "$tag" > "$output/docker-image-id"
docker run --rm --entrypoint cat "$tag" /app/dist/build-hash > "$output/build-hash"
python3 - "$output" "$config_hash" <<'PY'
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
    "architecture": "arm64", "entrypoint": "application" if sys.argv[2] else "attestation-bootstrap",
    "liveCustodyEnabled": bool(sys.argv[2]),
    **({"configSha256": sys.argv[2]} if sys.argv[2] else {}),
    "dockerImageId": (directory / "docker-image-id").read_text().strip(),
    "buildHash": (directory / "build-hash").read_text().strip(),
    "eifSha256": digest.hexdigest(),
    "measurements": json.loads((directory / "measurements.json").read_text())["Measurements"],
}
(directory / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Release manifest created. Verify a fresh quote after non-debug launch.")
PY
