FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY services/enclave ./services/enclave
RUN pnpm install --frozen-lockfile && pnpm --filter @cloakroom/shared build \
    && pnpm --filter @cloakroom/enclave build \
    && pnpm --filter @cloakroom/enclave deploy --prod --legacy /runtime

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv util-linux ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/nsm
WORKDIR /app
COPY services/enclave/nitro/requirements.txt /app/nitro/requirements.txt
RUN /opt/nsm/bin/pip install --no-cache-dir -r /app/nitro/requirements.txt
COPY --from=build /runtime /app
# Self-contained production dependencies; no symlinks point into the build workspace.
CMD ["python3", "/app/nitro/bridge.py", "enclave"]
