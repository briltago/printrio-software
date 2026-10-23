# syntax=docker/dockerfile:1

FROM node:25-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Release version (from the git tag in CI); package.json otherwise.
ARG PRINTRIO_VERSION=""
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN PRINTRIO_VERSION="$PRINTRIO_VERSION" pnpm build
# Runtime dependencies of the server only; workspace packages are bundled into dist/.
RUN pnpm --filter @printrio/server deploy --legacy --prod /out

FROM node:25-alpine AS runtime
ARG PRINTRIO_VERSION=""
ARG PRINTRIO_REVISION=""
LABEL org.opencontainers.image.title="Printrio" \
      org.opencontainers.image.description="Self-hosted control centre for 3D printing" \
      org.opencontainers.image.source="https://github.com/briltago/printrio-software" \
      org.opencontainers.image.url="https://printrio.app" \
      org.opencontainers.image.licenses="AGPL-3.0-only WITH AdditionRef-Printrio-Module-Exception" \
      org.opencontainers.image.version="${PRINTRIO_VERSION}" \
      org.opencontainers.image.revision="${PRINTRIO_REVISION}"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    DATA_DIR=/data
WORKDIR /app
# pg_dump/psql for backups (17 also dumps PostgreSQL 16 servers).
RUN apk add --no-cache postgresql17-client tar
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
COPY --from=build /repo/apps/server/package.json ./package.json
COPY --from=build /repo/LICENSE /repo/LICENSE-EXCEPTION.md /repo/COPYRIGHT ./
# Instance data (generated APP_SECRET for encrypting printer credentials).
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/index.js"]
