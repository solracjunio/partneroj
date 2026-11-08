# Production images, built on the server from the repository root:
#   docker compose -f infra/production/compose.yml build
# Two targets: `app` (API, worker and the migrate step share it) and `web`
# (Caddy with the built front end and the prototype baked in).

FROM node:26-alpine AS pnpm
# Node 25+ no longer ships corepack. Keep in sync with "packageManager".
RUN npm install --global pnpm@12.9.0
WORKDIR /repo

# Only the manifests first: dependencies are reinstalled only when one of
# them changes, not on every code change.
FROM pnpm AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN pnpm build

# Runtime: production dependencies and the compiled output only.
FROM manifests AS app
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/packages/domain/dist packages/domain/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
# runMigrations() reads the SQL files next to dist.
COPY packages/db/drizzle packages/db/drizzle
USER node
# Each service in compose.yml sets its own command.

FROM caddy:2 AS web
COPY infra/production/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/web
COPY prototype /srv/prototipo
