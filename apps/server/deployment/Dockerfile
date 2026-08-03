FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS contracts-build
WORKDIR /app
COPY packages/v2-contracts/package.json packages/v2-contracts/package-lock.json ./packages/v2-contracts/
RUN npm ci --prefix packages/v2-contracts
COPY packages/v2-contracts ./packages/v2-contracts
RUN npm run build --prefix packages/v2-contracts

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS sdk-build
WORKDIR /app
COPY sdk/package.json sdk/package-lock.json ./sdk/
RUN npm ci --prefix sdk
COPY sdk ./sdk
RUN npm run build --prefix sdk

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS web-build
WORKDIR /app
COPY packages/v2-contracts/package.json packages/v2-contracts/package-lock.json ./packages/v2-contracts/
RUN npm ci --prefix packages/v2-contracts
COPY packages/v2-contracts ./packages/v2-contracts
RUN npm run build --prefix packages/v2-contracts
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN npm ci --prefix apps/web
COPY apps/web ./apps/web
RUN npm run build --prefix apps/web

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS server-build
WORKDIR /app
COPY packages/v2-contracts/package.json packages/v2-contracts/package-lock.json ./packages/v2-contracts/
RUN npm ci --prefix packages/v2-contracts
COPY packages/v2-contracts ./packages/v2-contracts
RUN npm run build --prefix packages/v2-contracts
COPY sdk/package.json sdk/package-lock.json ./sdk/
RUN npm ci --prefix sdk
COPY sdk ./sdk
RUN npm run build --prefix sdk
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/
RUN npm ci --prefix apps/server
COPY apps/server ./apps/server
RUN npm run build --prefix apps/server
RUN touch /server-build-verified

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e
WORKDIR /app
COPY packages/v2-contracts/package.json packages/v2-contracts/package-lock.json ./packages/v2-contracts/
RUN npm ci --prefix packages/v2-contracts --omit=dev
COPY --from=contracts-build /app/packages/v2-contracts/dist ./packages/v2-contracts/dist
COPY sdk/package.json sdk/package-lock.json ./sdk/
RUN npm ci --prefix sdk --omit=dev
COPY --from=sdk-build /app/sdk/dist ./sdk/dist
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/
RUN npm ci --prefix apps/server --omit=dev
COPY --from=server-build /app/apps/server/src/download-grant-config.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/download-grant-service.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/environment-config.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/executable.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/origin-listener.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/process-save.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/processor-config.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/processor-service.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/publisher-config.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/publisher-service.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/publisher-worker.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/r2-download-grant.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/r2-provider.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/rig-worker-config.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/rig-worker.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/seestar-solar-adapter.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/server.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/solar-test.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/source-ingest.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/sqlite-resilience.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/src/web-host.ts ./apps/server/src/
COPY --from=server-build /app/apps/server/scripts/backup-preflight.ts ./apps/server/scripts/
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
COPY --from=server-build /server-build-verified /tmp/server-build-verified
RUN rm /tmp/server-build-verified
WORKDIR /app/apps/server
RUN node --experimental-strip-types --input-type=module -e "await import('@astro-console/v2-contracts'); await import('seestar-sdk')"
RUN mkdir -p /var/lib/astro-console && chown node:node /var/lib/astro-console
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
