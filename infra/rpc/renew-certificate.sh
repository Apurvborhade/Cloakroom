#!/usr/bin/env bash
set -euo pipefail
umask 077

directory=/etc/cloakroom-rpc
exec 9>/run/cloakroom-rpc-certificate.lock
flock -n 9 || exit 0
scratch=$(mktemp -d "$directory/acme.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
curl -fsS --max-time 15 http://127.0.0.1:9081/csr -o "$scratch/request.csr"
openssl req -in "$scratch/request.csr" -noout -verify

if ! { test -s "$directory/fullchain.pem" \
  && openssl x509 -in "$directory/fullchain.pem" -checkend 2592000 -noout \
  && cmp -s <(openssl req -in "$scratch/request.csr" -pubkey -noout) \
    <(openssl x509 -in "$directory/fullchain.pem" -pubkey -noout); }; then
  /opt/cloakroom-rpc/acme/bin/certbot certonly --standalone --non-interactive \
    --agree-tos --register-unsafely-without-email --preferred-challenges http \
    --csr "$scratch/request.csr" --cert-path "$scratch/cert.pem" \
    --chain-path "$scratch/chain.pem" --fullchain-path "$scratch/fullchain.pem"
  mv "$scratch/fullchain.pem" "$directory/fullchain.pem"
fi

# Retry installation even when a previous issuance succeeded but its upload failed.
curl -fsS --max-time 15 -X POST -H 'Content-Type: application/x-pem-file' \
  --data-binary "@$directory/fullchain.pem" http://127.0.0.1:9081/certificate
