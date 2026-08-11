FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/vendor/ui-package-trials/nightbook-ui-0.1.1-sha256-59482f0a8ffbb25d3458ddfec5f569020ffc05e8531d15add46fda9f0391d262.tgz ./apps/web/vendor/ui-package-trials/nightbook-ui-0.1.1-sha256-59482f0a8ffbb25d3458ddfec5f569020ffc05e8531d15add46fda9f0391d262.tgz
COPY packages/protocol/package.json ./packages/protocol/package.json
RUN npm ci

COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY packages/protocol ./packages/protocol
RUN npm run build --workspace @astro-console/protocol
RUN npm run build --workspace @astro-console/web
RUN npm run build --workspace @astro-console/server

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends astrometry.net \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
RUN npm ci --omit=dev --workspace @astro-console/server

COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/scripts/backup-preflight.ts ./apps/server/scripts/
COPY --from=build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
RUN node --experimental-strip-types --input-type=module -e "await import('@astro-console/protocol')"
RUN mkdir -p /var/lib/astro-console && chown node:node /var/lib/astro-console
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
