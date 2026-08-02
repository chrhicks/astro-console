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
COPY apps/server ./apps/server
WORKDIR /app/apps/server
RUN node --experimental-strip-types --input-type=module -e "await import('@astro-console/v2-contracts'); await import('seestar-sdk')"
RUN mkdir -p /var/lib/astro-console && chown node:node /var/lib/astro-console
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
