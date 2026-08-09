FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/vendor/ui-package-trials/nightbook-ui-0.1.1-sha256-59482f0a8ffbb25d3458ddfec5f569020ffc05e8531d15add46fda9f0391d262.tgz ./apps/web/vendor/ui-package-trials/nightbook-ui-0.1.1-sha256-59482f0a8ffbb25d3458ddfec5f569020ffc05e8531d15add46fda9f0391d262.tgz
COPY packages/v2-contracts/package.json ./packages/v2-contracts/package.json
RUN npm ci

COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY packages/v2-contracts ./packages/v2-contracts
RUN npm run build --workspace @astro-console/v2-contracts
RUN npm run build --workspace @astro-console/web
RUN npm run build --workspace @astro-console/server

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends astrometry.net \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/v2-contracts/package.json ./packages/v2-contracts/package.json
RUN npm ci --omit=dev --workspace @astro-console/server

COPY --from=build /app/packages/v2-contracts/dist ./packages/v2-contracts/dist
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/scripts/backup-preflight.ts ./apps/server/scripts/
COPY --from=build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
RUN node --experimental-strip-types --input-type=module -e "await import('@astro-console/v2-contracts')"
RUN mkdir -p /var/lib/astro-console && chown node:node /var/lib/astro-console
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
