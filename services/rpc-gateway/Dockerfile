FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/attestation ./packages/attestation
COPY services/enclave ./services/enclave
COPY services/rpc-gateway ./services/rpc-gateway
ARG RPC_CONFIG_SHA256
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @cloakroom/shared build && pnpm --filter @cloakroom/attestation build \
    && pnpm --filter @cloakroom/enclave build && pnpm --filter @cloakroom/rpc-gateway build \
    && pnpm --filter @cloakroom/rpc-gateway deploy --prod --legacy /runtime

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv openssl ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* && python3 -m venv /opt/nsm
COPY services/enclave/nitro /app/common
RUN /opt/nsm/bin/pip install --no-cache-dir -r /app/common/requirements.txt
COPY --from=build /runtime /app
WORKDIR /app
ENV PYTHONPATH=/app/common
CMD ["python3", "/app/nitro/gateway.py", "enclave"]
