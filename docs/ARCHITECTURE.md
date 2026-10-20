# Printrio — Architecture

> Companion to [`VISION.md`](VISION.md). Describes how the pieces fit; details
> evolve with the code, decisions recorded here are binding until changed here.

## 1. Repositories

| Repository           | Visibility | Licence                         | Contents |
| -------------------- | ---------- | ------------------------------- | -------- |
| `printrio-software`  | public     | AGPL-3.0 + module exception     | The self-hosted app (Free tier), module SDK, Docker images |
| `printrio-pro`       | private    | proprietary                     | Pro module, built against `@printrio/sdk` |
| `printrio-business`  | private    | proprietary                     | Business module, built against `@printrio/sdk` |
| `printrio-licensing` | private    | proprietary                     | Licence + module distribution service (Cloudflare Workers, D1, R2) |
| `printrio-website`   | private    | —                               | Marketing site (printrio.app) |

## 2. Stack

TypeScript end to end, so types are shared between server, web UI and modules.

| Concern            | Choice |
| ------------------ | ------ |
| Runtime            | Node.js 22 LTS |
| Package manager    | pnpm workspaces + Turborepo |
| HTTP server        | Fastify 5 |
| Database           | PostgreSQL 16+ with Drizzle ORM and SQL migrations |
| Background jobs    | pg-boss (PostgreSQL-backed, no extra service) |
| Realtime           | WebSocket (`@fastify/websocket`) |
| Validation         | Zod (shared between server and web) |
| Web UI             | React 19, Vite, TanStack Router + Query, Tailwind CSS |
| Tests              | Vitest (unit + integration against PostgreSQL), Playwright (e2e, later) |
| Lint/format        | Biome |
| Packaging          | One Docker image (server serves the built web UI) + Docker Compose |

## 3. `printrio-software` layout

```
apps/
  server/        Fastify API, WebSocket hub, drivers, module host, serves web UI
  web/           React single-page app
packages/
  shared/        Zod schemas and types shared by server, web and modules (tiers, lease, API DTOs)
  sdk/           Public module SDK: PrintrioModule, PrinterDriver, host context types
docker/          Dockerfile and Compose files
docs/            Vision, architecture, decisions
```

## 4. Deployment

```
┌────────────── Docker Compose ──────────────┐
│  printrio (Node)  ──────────►  postgres     │
│   ├─ REST + WebSocket API                   │
│   ├─ web UI (static)                        │
│   ├─ printer drivers ──────────────┐        │
│   └─ module host (Pro/Business)    │        │
└────────────────────────────────────┼────────┘
                                     ▼
              Moonraker (Klipper host) on LAN or via Tailscale
```

- **Home / LAN:** NAS, mini PC, home server. Printers reachable directly.
- **Hosted:** VPS or paid hosting; printers reached over Tailscale (or another
  overlay VPN). Later option: a small outbound-connecting *Printrio agent* on
  the printer host, removing the VPN requirement.
- Raspberry Pi 4/5 (arm64) is a supported target, so images are multi-arch.
- Exposed to the internet ⇒ authentication is mandatory from F0, HTTPS via a
  reverse proxy (optional Caddy service in Compose).

## 5. Printer drivers

All printer communication goes through `PrinterDriver` (`packages/sdk`). The
core ships the Moonraker driver; others follow the same interface. A driver
normalises status (state, temperatures, progress, current file, filament
usage) into shared types and exposes commands (pause, resume, cancel, G-code,
upload, start). Nothing outside a driver knows about Moonraker specifics.

Slicer upload: the server implements the OctoPrint-compatible upload endpoint
(`/api/files/local`) that OrcaSlicer, PrusaSlicer and Cura already support, so
slicers can send directly to Printrio.

### Live data

`PrinterManager` keeps one driver connection per printer and reconnects with
exponential backoff (1 s → 30 s). Browsers subscribe to `/api/ws` (session
required) and receive `printer.status`, `printer.console` and
`printers.changed` messages (`realtimeMessageSchema` in `packages/shared`);
the web app writes them straight into the TanStack Query cache.

The console buffer lives in the browser (500 lines per printer). On first
open it is replaced by the printer's own backlog (Moonraker `gcode_store`,
which already contains everything streamed so far), so a reload or a second
browser shows the same history. Firmware errors arrive as `!! …` lines, so the
console does not repeat them as form errors. Autocomplete uses
`printer.gcode.help`; macros come from `gcode_macro` objects plus their
`configfile` section, whose Jinja template is scanned for `params.X` to offer
parameter fields. Macros starting with `_` are hidden, as in Mainsail/Fluidd.

### Webcams

Webcams come from Moonraker's webcam list. Relative URLs resolve against the
printer host on the web-server port (not Moonraker's). Media is **proxied by
the Printrio server** (`/api/printers/:id/webcams/:index/stream|snapshot`):
it stays behind the session, works when only the server can reach the printer
(hosted Printrio over Tailscale), and the API never exposes camera URLs.
MJPEG streams are piped through; adaptive/WebRTC cameras fall back to polled
snapshots when a snapshot URL exists.

### Printer maintenance

`/printers/:id/maintenance` holds stage B (printer administration). Config
files are read and written through Moonraker's `config` root. Before every
save the printer's current version is copied into Printrio's database
(`config_backups`, last 30 per file), so a bad edit can be undone even when
the printer's own copy is gone. Saves carry the `modified` time the editor
loaded; if the printer's file changed meanwhile the API answers 409 and the
user decides whether to overwrite. G-code requests wait up to 30 minutes
(homing, heating and mesh calibration take a while); other requests time out
after 10 s.

Permissions: config, services, host reboot/shutdown and updates are
admin-only. Restarting Klipper or the firmware is open to operators because
it is the way back from an emergency stop. No restart is accepted while the
printer is printing or paused.

### Workspace settings

Instance-wide settings (usage mode, start page, sidebar order/visibility,
onboarding state) live in `instance_settings` as one validated JSON document
(`workspaceSettingsSchema`). Per-browser preferences (theme, fleet view mode)
stay in `localStorage`.

### Web app conventions

- All UI strings go through `useT()` (`apps/web/src/i18n`). English is the only
  locale today; another language is a file shaped like `en.ts`.
- Theme tokens are CSS variables; `<html data-theme="light|dark">` switches them
  (see `docs/DESIGN.md`).
- `pnpm dev:printers` (in `apps/server`) starts six simulated Moonraker printers
  for UI work; tests use the same simulator.

## 6. Modules (Pro / Business)

- A module is a JavaScript bundle implementing `PrintrioModule` from
  `@printrio/sdk`. It receives a **host context** (scoped DB access via its own
  schema/migrations, route registration, UI extension points, event bus,
  licence information).
- Modules are **only obtainable after activation**: the core downloads them
  from `printrio-licensing` using the instance's licence lease.
- Every module bundle is **signed (Ed25519)**; the core refuses to load
  unsigned or tampered bundles. Public keys are pinned in the core.
- Modules re-check the licence themselves (not only the core), are minified
  and obfuscated, and some value is server-side (push notifications, remote
  access, backups, later AI failure detection) so it cannot be unlocked locally.
- The open-source core contains **no Pro/Business feature code**, only
  extension points. Per the module exception to AGPL, modules using only the
  public SDK are not covered by the AGPL.

Honest threat model: a determined attacker can patch client-side code. The
goal is that cracking is not worth it, not that it is impossible.

## 7. Licensing protocol

1. On first start the instance creates an **instance identity** (Ed25519
   keypair, stored in the DB). Instance ID = hash of the public key.
2. **Activation:** admin enters a licence key → core calls
   `POST /v1/activate` with key + instance public key. One licence binds to
   one instance (re-binding via the customer portal / support).
3. The service returns a **signed lease** (Ed25519, compact JWS):
   `{ licenceId, instanceId, tier, limits: { printers, users }, features[], modules[], issuedAt, expiresAt }`
   where `expiresAt = issuedAt + 72 h`.
4. The core **refreshes every ~6 h** (`POST /v1/refresh`, signed by the
   instance key). A successful refresh extends the lease; so the 72 h grace
   period always counts from the last successful check.
5. Lease expired / revoked ⇒ instance falls back to **Free**:
   - running prints are never touched,
   - module data stays in the database, read-only/hidden until reactivation,
   - printers above the Free limit stay visible but cannot start new jobs.
6. Limits and features are plain values in the lease, so add-on packs or
   per-printer billing need no code change in the core.

Payment provider webhooks (Paddle / Lemon Squeezy) update subscriptions in
`printrio-licensing`; the next refresh picks up the change.

## 8. Security baseline

- Passwords hashed with Argon2id; server-side sessions in PostgreSQL, opaque
  token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when served over HTTPS).
- First-run setup creates the initial admin; setup is closed once a user exists.
- All input validated with Zod; no secrets in source; config via environment.
- Printer credentials (API keys) encrypted at rest (AES-256-GCM) with
  `APP_SECRET`, or a secret generated on first start in `DATA_DIR`
  (`/data` volume in Docker). Back up that volume together with the database.
- Admins manage printers, users and settings; operators run printers. At least
  one administrator always remains.

## 9. Licensing of the core

- `LICENSE` — GNU AGPL-3.0.
- `LICENSE-EXCEPTION.md` — additional permission for modules that use only the
  public module SDK.
- `CLA.md` — contributors grant the right to relicense, keeping the
  open-core model possible.
