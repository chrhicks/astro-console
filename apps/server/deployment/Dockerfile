FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS contracts-build
WORKDIR /app
COPY packages/v2-contracts/package.json packages/v2-contracts/package-lock.json ./packages/v2-contracts/
RUN npm ci --prefix packages/v2-contracts
COPY packages/v2-contracts ./packages/v2-contracts
RUN npm run build --prefix packages/v2-contracts

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
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/
RUN npm ci --prefix apps/server --omit=dev
COPY --from=server-build /app/apps/server/src ./apps/server/src
COPY --from=server-build /app/apps/server/scripts/backup-preflight.ts ./apps/server/scripts/
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
COPY --from=server-build /server-build-verified /tmp/server-build-verified
RUN rm /tmp/server-build-verified
WORKDIR /app/apps/server
RUN node --experimental-strip-types --input-type=module -e "await import('@astro-console/v2-contracts')"
RUN mkdir -p /var/lib/astro-console && chown node:node /var/lib/astro-console
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
