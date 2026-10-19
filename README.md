# Printrio

Self-hosted control centre for 3D printing — printers, files, filament spools,
job costs and orders in one workspace. Klipper/Moonraker first; more printer
ecosystems through drivers.

> Status: early development (phase F0 — foundation). Not ready for production use.

- Product vision: [`docs/VISION.md`](docs/VISION.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Run with Docker Compose

```sh
cp .env.example .env        # set POSTGRES_PASSWORD
docker compose up -d --build
```

Open `http://<host>:3000` and create the administrator account. When Printrio is
served over HTTPS (reverse proxy, Tailscale Serve, …) set `COOKIE_SECURE=true`.

## Development

Requirements: Node.js 22, pnpm 10 (`corepack enable`), PostgreSQL 16.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env   # point DATABASE_URL at your database
pnpm dev            # server on :3000, web UI on :5173 (proxies /api)
```

| Command          | What it does |
| ---------------- | ------------ |
| `pnpm lint`      | Biome lint + format check (`pnpm format` to fix) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test`      | Unit tests + server integration tests (needs `TEST_DATABASE_URL` or a local `printrio_test` database) |
| `pnpm build`     | Production build (server bundle + web UI) |
| `pnpm db:generate` | Generate a SQL migration after changing `apps/server/src/db/schema.ts` |

## Repository layout

```
apps/server      Fastify API, auth, migrations; serves the built web UI
apps/web         React UI (Vite, TanStack Router/Query, Tailwind)
packages/shared  Zod schemas and types shared by server, web and modules
packages/sdk     Public module + printer driver SDK
docker/          Container image
docs/            Vision and architecture
```

## Licence

Printrio is licensed under the [GNU AGPL-3.0](LICENSE) with an
[additional permission for modules](LICENSE-EXCEPTION.md) built on the public
module SDK. Contributions require agreeing to the [CLA](CLA.md).
