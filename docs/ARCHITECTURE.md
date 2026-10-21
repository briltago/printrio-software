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

Logs are read from Moonraker's `logs` root. The viewer gets the last 256 KB
(an HTTP suffix range, falling back to keeping the tail of a full read); the
full file is streamed as a download. Host information comes from
`machine.system_info`, live load from `machine.proc_stats`. Power devices
(`[power …]` in Moonraker) appear on the printer page for operators too;
devices marked `locked_while_printing` cannot be switched during a print.

The bed mesh tab (open to operators) reads Klipper's `bed_mesh` object on
demand and draws it as a heat map on a diverging scale (blue below zero, red
above, gray at zero, symmetric around zero), with a table view for exact
values. Calibrating homes first when needed. Saving or removing a profile
runs `SAVE_CONFIG`, which writes printer.cfg and restarts Klipper, so it is
admin-only.

Updates use Moonraker's update manager (`machine.update.*`; older Moonraker
without `machine.update.upgrade` falls back to the per-kind endpoints).
Progress notifications are forwarded as `printer.update` realtime messages,
to admins only. Updating Moonraker restarts it, so the dropped connection is
treated as success and the UI retries until the printer is back.

Permissions: config, logs, system info, services, host reboot/shutdown and updates are
admin-only. Restarting Klipper or the firmware is open to operators because
it is the way back from an emergency stop. No restart is accepted while the
printer is printing or paused.

### Filament inventory

`filaments` are products (vendor, material, colour, diameter, density,
defaults for spool weight and price); `spools` are physical rolls with their
initial and remaining net weight, empty-spool weight, price, location and
lot. A printer has at most one `active_spool_id`, assigned by hand. Weighing
a spool sets remaining = scale reading − empty-spool weight. Archiving a
spool unloads it from every printer.

The Spoolman import reads `/api/v1/spool` once and upserts filaments and
spools by an external id (`spoolman:<url>#spool-<id>`), so running it again
updates instead of duplicating. Automatic consumption and stock alerts are
Pro features and stay out of the core.

### G-code library (Files)

The Files section is Printrio's own library, not a merge of the printers'
storage: G-code lives in `DATA_DIR/files` (the `/data` Docker volume), so it
survives printer resets and can be sent to any printer. The files on disk
are the source of truth; `library_files` caches slicer metadata (time,
filament, layer height, material, the largest embedded thumbnail) and is
refreshed when a file's size or mtime changes, so files copied into the
volume by hand appear too. Uploads stream to a temporary file and are renamed
into place. "Print" uploads the file to the printer's G-code root (streamed
from disk) and optionally starts it when the printer is idle. Metadata is
read from the first 1 MB and the last 512 KB of a file (PrusaSlicer,
SuperSlicer, OrcaSlicer, Bambu Studio and Cura comment formats).

### Slicer upload (OctoPrint-compatible)

PrusaSlicer, SuperSlicer, OrcaSlicer and Bambu Studio upload through a small
OctoPrint-compatible API: `/octoprint/<target>/api/version` (connection test)
and `/octoprint/<target>/api/files/local` (multipart, with the `path` and
`print` fields). `<target>` is `library` or a printer id. Every upload lands in
the library; for a printer target it is also uploaded there, and with
`print=true` it starts when the printer is idle or is queued (source
`library`) when it is busy — never interrupting a print. Authentication uses
personal API keys (`X-Api-Key` header or `apikey` query); only a SHA-256 hash
and a short prefix are stored, and uploads are attributed to the key's
owner. Queue items with source `library` are uploaded to the printer when
they start.

### Job records and costs

`JobRecorder` listens to printer status: a job opens (`print_jobs`, status
`printing`) when a printer starts printing, with a snapshot of the loaded
spool, and closes when the printer is idle or in error again. The final
status, duration and filament come from the printer's own history
(`listJobs`), falling back to the last live values ("interrupted" when the
history does not know the job). Offline or reconnecting states never close a
job, and open jobs are reloaded after a server restart.

The cost is stored when the job closes (Free: material + energy):
material = filament length → grams (diameter, density) × spool price per gram;
energy = printer power (per printer, or the workspace default) × print time ×
electricity price. Without a priced spool the material cost stays empty
rather than guessed. Prices, margins and profit are Pro.

### Orders

Free orders are deliberately small: a name, the customer as plain text, a
status (new, in progress, done, cancelled), notes and the recorded prints
linked to them (`print_jobs.order_id`). The order shows the summed cost of
its prints. Line items, quantities, prices, deadlines and scheduling into the
queue are Pro. Deleting an order keeps its prints in the history.

### Per-printer queue

`queue_items` hold files waiting on one printer, ordered by `position`, with
copies and an optional order. The next print is started by hand ("Start
next", only when the printer is idle) because someone has to clear the bed;
starting removes the item and tells the job recorder which order the new
job belongs to. Fleet queues, automatic assignment and filament matching are
Pro.

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

- A module is a **signed bundle** with a server part (an ES module whose
  default export implements `PrintrioModule` from `@printrio/sdk`) and an
  optional web part (default export `PrintrioWebModule`).
- Modules are **only obtainable after activation**: the core downloads the
  modules listed in the lease from `printrio-licensing`
  (`GET /v1/modules/:id/:version`, `Authorization: Bearer <lease>`) and caches
  them in `DATA_DIR/modules`.
- Bundle format (`moduleBundleSchema` in `@printrio/shared`): JSON with
  `manifest`, base64 `server`/`web` code, their SHA-256 and an **Ed25519
  signature** over `moduleSigningMessage(...)`, made offline with the module
  key. The core verifies hashes and signature against the **pinned public key**
  (`packages/shared/src/licensing-keys.ts`) every time it loads a bundle, and
  checks that the lease's tier covers `requiresTier` and that
  `manifest.coreVersion` equals `MODULE_API_VERSION`.
- **Server host context** (`ModuleContext`): logger, current lease, SQL access
  (`search_path` = the module's own schema `module_<id>`, then `public`),
  migrations applied once each in that schema, routes under
  `/api/modules/<id>/…` (signed-in users; `adminOnly` for admins), driver
  registration, core events (`printer.status`, `job.started`, `job.finished`,
  `licence.changed`) and `notifyChange` to refresh open browsers.
- **Order events** (`order.created`, `order.updated`, `order.deleted`) let a
  module build on the core's orders (Pro: customer directory).
- **Web extension points**: after sign-in the UI imports
  `/api/modules/<id>/web.js` and calls `setup(host)`. The host passes its own
  React, JSX runtime, TanStack Query, `api()`, UI components and formatters
  (also as `window.PrintrioHost`, so bundles never ship a second React).
  A module can add sidebar entries, pages (`/m/<id>/<path>`), settings tabs,
  printer-page panels and order-detail sections (`orderPanels`).
- **API keys for module routes**: integrations call `/api/modules/<id>/…`
  with `Authorization: Bearer prk_…` (personal API keys, Settings → Slicer
  upload) and act as that user. The core's own API stays session-only.
- **Roles and audit for modules**: every change request is mapped to a
  permission (`permissionFor` in `@printrio/shared`: printers.control,
  printers.manage, files.manage, queue.manage, orders.manage, filament.manage,
  module.pro, module.business). For non-admin users, authorizers registered
  with `ctx.registerAuthorizer` may refuse it (403; fail-closed on errors).
  After each change request the core emits `request.completed` (user, method,
  path, route, status, permission, IP — never bodies) for audit logs.
- **Orders for modules**: `ctx.orders` (get, create, update) runs the same
  order logic as the HTTP API — folder from the workspace template, order
  events — so Business can turn an accepted quote into a normal order.
- When the lease ends or no longer lists a module, the module is deactivated:
  its routes and UI disappear, its data stays in its schema until
  reactivation.
- Modules re-check the licence themselves (not only the core), are minified,
  and some value is server-side (push notifications, remote access, backups,
  later AI failure detection) so it cannot be unlocked locally.
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

Payment provider webhooks (Paddle Billing) update subscriptions in
`printrio-licensing`; the next refresh picks up the change.

Implementation in the core (`apps/server/src/licensing/`):

- `identity.ts` — Ed25519 instance key in `instance_settings`
  (`instance_identity`, private key encrypted with the instance secret).
  Instance ID = first 32 hex characters of sha256(raw public key).
- `licence.ts` — activation, refresh every 6 h (retry every 15 min after a
  failure), deactivation, customer-portal link. The lease is verified with the
  pinned lease key and must name this instance. Limits for printers and users
  come from `licence.limits()`.
- `modules.ts` — download, verification, loading and unloading of modules.
- Settings → Licence (admins) shows the plan, activates a key, checks now,
  opens the subscription portal and deactivates.
- Builds without pinned keys (self-built from source) stay on Free;
  activation explains that an official release is needed. Tests pass their
  own keys through `buildApp({ licensing })`.

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
