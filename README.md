# Printrio

Self-hosted control centre for 3D printing: printers, files, filament spools,
job costs, orders and queues in one workspace. Printrio runs on your own
hardware (a home server, NAS, mini PC, Raspberry Pi 4/5 or a VPS) and talks to
Klipper printers through Moonraker.

Website and documentation: **[printrio.app](https://printrio.app)** ·
[Installation guide](https://printrio.app/installation) ·
[Documentation](https://printrio.app/docs)

## Features

- **Printers**: live status, webcams, temperatures, motion and print tuning,
  console and macros, printer groups and tags.
- **Maintenance**: Klipper config editor with backups and restarts, logs,
  system info, power devices, bed mesh, Moonraker update manager.
- **Files**: G-code library with folders, upload from PrusaSlicer, SuperSlicer,
  OrcaSlicer and Bambu Studio (OctoPrint-compatible endpoint).
- **Filament**: per-spool inventory with material, colour and remaining weight;
  import from Spoolman.
- **Jobs and costs**: print history with filament use and material and energy cost.
- **Orders and queues**: simple orders with their own folder, per-printer
  queues.
- **Team**: administrator and operator accounts.
- **Backups**: database and data in one archive, scheduled or on demand,
  restore from Settings → Backups; automatic backup before each update.
- **Languages**: English, Czech and German.

Printrio Free covers up to 3 printers and 2 users. **Pro** (fleet queue,
orders with items and deadlines, customers, statistics, notifications) and
**Business** (quotes to invoices, CRM, e-shop import, API and webhooks, roles
and audit log, single sign-on, stock and purchasing, service levels,
escalation, multiple sites) are add-on modules unlocked with a licence key —
see [pricing](https://printrio.app/pricing).

## Install

Requirements: Docker with the Compose plugin, amd64 or arm64.

```sh
mkdir printrio && cd printrio
curl -fsSLO https://raw.githubusercontent.com/briltago/printrio-software/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/briltago/printrio-software/main/.env.example
# edit .env: set POSTGRES_PASSWORD to a long random value
docker compose up -d
```

Open `http://<host>:3000`, create the administrator account and follow the
setup wizard to add your first printer (its Moonraker address, usually
`http://<printer-ip>:7125`).

### Configuration (`.env`)

| Variable            | Default  | Meaning |
| ------------------- | -------- | ------- |
| `POSTGRES_PASSWORD` | —        | Password of the bundled PostgreSQL database (required, any characters; write a literal `$` as `$$`). |
| `PRINTRIO_PORT`     | `3000`   | Port Printrio listens on, inside the container and on the host. |
| `COOKIE_SECURE`     | `false`  | Set to `true` when Printrio is served over HTTPS. |
| `TRUST_PROXY`       | `false`  | Behind a reverse proxy: `1` (one proxy hop) or the proxy's address/CIDR, so rate limits and logs see the real client address. |
| `PRINTRIO_VERSION`  | `latest` | Image tag to run: `latest`, a release such as `0.9.0`, or `edge` (newest build from `main`). |

Further settings, passed as environment variables of the `printrio` service:
`APP_SECRET` (encrypts printer credentials; generated and stored in the data
volume when unset), `LOG_LEVEL` (`info`), `UPDATE_CHECK` (`true`; set `false`
to stop checking GitHub for new releases), `PRINTRIO_SOURCE_URL` (link to the source code shown in the app;
set it to your repository if you run a modified version, as the AGPL requires).

### HTTPS and remote access

Printrio itself serves plain HTTP. For access from outside your network put it
behind a reverse proxy with TLS (Caddy, Traefik, nginx) or use Tailscale
Serve, set `COOKIE_SECURE=true`, and set `TRUST_PROXY=1` when the proxy forwards the client address. Never expose Moonraker directly to the
internet.

### Updates

```sh
docker compose pull && docker compose up -d
```

Administrators see a notice in the app when a new release is out. Before
database migrations run, Printrio saves a backup automatically. To stay on a
version, set `PRINTRIO_VERSION` in `.env`.

### Backups

Settings → Backups creates and downloads backups (the database and the data
volume, optionally including the G-code library) and can run them daily with a
retention you choose. Backups are stored in the `printrio-data` volume, so also
copy them off the machine. Restoring a backup replaces all data and restarts
Printrio.

## Development

Requirements: Node.js 22, pnpm 10 (`corepack enable`), PostgreSQL 16.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env   # point DATABASE_URL at your database
pnpm dev            # server on :3000, web UI on :5173 (proxies /api)
pnpm --filter @printrio/server dev:printers   # six simulated Klipper printers on :7125–7130
```

| Command            | What it does |
| ------------------ | ------------ |
| `pnpm lint`        | Biome lint + format check (`pnpm format` to fix) |
| `pnpm typecheck`   | TypeScript across all packages |
| `pnpm test`        | Unit tests + server integration tests (needs `TEST_DATABASE_URL` or a local `printrio_test` database). With `MOONRAKER_TEST_URL` (and `MOONRAKER_TEST_API_KEY` if needed) pointing at a **test** Moonraker + Klipper without hardware, `apps/server/test/moonraker-live.test.ts` also runs the driver against it: upload, print, pause, cancel and emergency stop |
| `pnpm build`       | Production build (server bundle + web UI) |
| `pnpm db:generate` | Generate a SQL migration after changing `apps/server/src/db/schema.ts` |

To build the image yourself: `docker compose build`. Licence keys work in builds
that keep the pinned public keys in `packages/shared/src/licensing-keys.ts`.

```
apps/server      Fastify API, printer drivers, module host; serves the built web UI
apps/web         React UI (Vite, TanStack Router/Query, Tailwind)
packages/shared  Zod schemas and types shared by server, web and modules
packages/sdk     Module and printer driver SDK
docker/          Container image
docs/            Architecture
```

How the pieces fit together is described in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Support

Questions and bug reports: [GitHub issues](https://github.com/briltago/printrio-software/issues)
or [support@printrio.app](mailto:support@printrio.app).

## Licence

Copyright (C) 2026 Jakub Banci. Printrio is free software licensed under the
[GNU AGPL-3.0-only](LICENSE) with an [additional permission for modules](LICENSE-EXCEPTION.md)
built on the module interface; see [COPYRIGHT](COPYRIGHT). Every Printrio
instance links to its source code at the bottom of the sidebar and on the sign-in page. Contributions require
agreeing to the [CLA](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md). Report
security issues as described in [SECURITY.md](SECURITY.md).
