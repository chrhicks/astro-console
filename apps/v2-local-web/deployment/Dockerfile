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
COPY sdk/package.json sdk/package-lock.json ./sdk/
RUN npm ci --prefix sdk --omit=dev
COPY --from=sdk-build /app/sdk/dist ./sdk/dist
COPY apps/v2-local-web/package.json apps/v2-local-web/package-lock.json ./apps/v2-local-web/
RUN npm ci --prefix apps/v2-local-web --omit=dev
COPY apps/v2-local-web ./apps/v2-local-web
WORKDIR /app/apps/v2-local-web
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
