# Printrio — Product vision

> Status: agreed direction, v0.1 (October 2026). Numbers marked *proposed* are
> starting points to validate with beta users, not published pricing.

## 1. What Printrio is

Printrio is a **self-hosted control centre for 3D printing** — from a single
printer on a desk to a print farm that runs a business. It replaces the
patchwork most people run today:

| Today people use…                         | Printrio provides…                          |
| ----------------------------------------- | ------------------------------------------- |
| Mainsail / Fluidd (one tab per printer)    | One workspace for every printer             |
| Spoolman                                   | Per-spool filament inventory, built in      |
| OctoFarm / SimplyPrint / Printago          | Fleet overview, queue, job routing          |
| Spreadsheets                               | Job costing, orders, customers              |

Printrio does **not** replace printer firmware. It sits above it (Klipper via
Moonraker first) and talks to printers through drivers.

> Naming note: "3DPrinterOS" is an existing commercial product. Internally we
> may call Printrio a "printer OS"; public copy should not use that phrase.

## 2. Who it is for

1. **Makers** — 1–3 printers, hobby or occasional selling.
2. **Small print businesses** — 3–15 printers, Etsy/e-shop sellers, prototyping shops.
3. **Print farms and teams** — 15+ printers, several operators, real customers.

## 3. Problems we solve (from community feedback)

- **No unified view.** Operators log in to every printer/Pi separately.
- **Files and jobs are moved by hand.** Sending a file to an idle printer,
  finding which printer has the right filament loaded, re-queuing a failed job.
- **Native tools break at ~3 printers.** File management hurts at 3–5 printers,
  job routing at 5–10.
- **Filament is tracked in a separate tool** (or not at all), so job costs are guesses.
- **Cloud lock-in.** The strongest farm tools are cloud-only or need a
  vendor client on your own hardware.
- **OctoFarm-era tools are unmaintained.**

## 4. How we win

1. **One place instead of five tools** — control, files, spools, queue, costs, orders.
2. **Self-hosted and private** — data stays with the operator; works offline on a LAN.
3. **Scales with the farm** — the tier boundaries sit exactly where native tools break.
4. **Multi-ecosystem by design** — a driver interface from day one: Moonraker
   first, then PrusaLink, Bambu Lab (MQTT) and OctoPrint.
5. **Business layer included** — Printrio knows what a print *costs* and what it *earns*.
6. **Easy migration** — Spoolman import, slicer upload compatibility.

## 5. Editions

The core (`printrio-software`) is open source (AGPL-3.0 with a module
exception). **Pro** and **Business** are closed-source modules downloaded by the
core after licence activation (see `ARCHITECTURE.md`).

### Guiding rule: split by value, not by counters

Any counter enforced inside open-source code can be patched out. So limits in
the core are a *nudge*, not the protection. The protection is that **the
features a growing operation needs are not in the core at all**:

- Free answers "what is my printer doing and what does a print cost me?"
- Pro answers "how do I run several printers efficiently and how much do I earn?"
- Business answers "how do I run a print company with a team and customers?"

Someone who patches the printer limit in Free gets 20 printers with no farm
tooling — Pro is still worth buying.

### Feature matrix (*proposed*)

|                              | **Free (core)**                                   | **Pro**                                                     | **Business**                                              |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Printers                     | 3                                                 | 8 included, add-on packs of +5 (max 20)                      | 20 included, then per printer, no cap                     |
| User accounts                | 2                                                 | 10                                                          | Unlimited                                                 |
| Printer control, webcam, console, macros | ✓                                     | ✓                                                           | ✓                                                         |
| Files, slicer upload (Orca/Prusa/Cura) | ✓                                       | ✓                                                           | ✓                                                         |
| Print history                | ✓                                                 | ✓ + statistics and failure analytics                        | ✓                                                         |
| Spools                       | ✓ inventory, manual assignment, Spoolman import    | ✓ automatic consumption, low-stock alerts                   | ✓ multi-location stock, purchasing                        |
| Job costing                  | Print cost (material + energy)                    | Price, margin, profit, reports                              | Price lists, discounts, VAT                               |
| Orders                       | Simple list: name, customer (text), status, linked jobs | Line items, quantities, deadlines, auto-scheduling into queue | Full flow: quote → order → production → shipping        |
| Customers                    | Name on an order only                             | Customer directory with history                             | CRM, invoices, e-shop integrations (Shopify, Etsy, WooCommerce) |
| Queue                        | Per-printer queue                                  | Fleet queue, auto-assignment, filament/printer matching     | ✓ + priorities per customer/SLA                           |
| Notifications                | In-app                                             | Discord, Telegram, email, push                              | ✓ + escalation rules                                      |
| Roles & permissions          | Admin / operator                                   | Admin / operator                                            | Granular roles, audit log, SSO                            |
| Integrations                 | —                                                 | —                                                           | REST API, webhooks, multiple sites                        |

**Printer-count pricing (decision):** Pro includes 8 printers and sells
add-on packs of +5 up to 20; Business includes 20 and is billed per additional
printer. This avoids forcing a 10-printer farm without a team into Business,
and keeps the licence model simple: limits are numbers in the signed licence.

### Replacing Mainsail / Fluidd

Goal: nobody needs Mainsail or Fluidd next to Printrio. Delivered in stages so
the product stays usable at every step:

| Stage | Scope | Result |
| ----- | ----- | ------ |
| **A — Daily operation** ✅ | Webcam, temperatures (targets, presets, 20-min chart), motion (home, jog, motors off, Z babystep), speed/flow/fan, exclude object, files on the printer (thumbnails, start, upload), print history, console (history, autocomplete), macros | Mainsail only needed for maintenance |
| **B — Printer administration** | Config editor (`printer.cfg` etc.) with backup and Klipper restart, firmware/Klipper restart, logs, bed mesh view, update manager, power devices, system info | Mainsail no longer needed |
| **C — Long tail** | Timelapse, input shaper graphs, other niche tools — by user demand | Feature parity where it matters |

Admin-only for everything that can break a printer (config editing, restarts,
updates); config writes always keep a backup.

### One app from one printer to a farm

The same workspace adapts to its size instead of shipping separate products:

- **Usage mode** chosen in the first-run wizard ("one or two printers" / "print farm") presets the sidebar; it can be changed later.
- **Start page**: automatic by default — a single printer opens its own page, several open the fleet overview; configurable.
- **Fleet view** scales from a handful of cards to compact tiles and a sortable list for large farms, with groups (rooms, sites) and tags.
- **Sidebar** sections can be hidden and reordered in Settings, so a hobbyist never sees order management unless they want it.

## 6. Business model

- **Subscription** (monthly / yearly), billed per instance.
- **Payment provider:** a Merchant of Record (Paddle or Lemon Squeezy) so EU
  and worldwide VAT is handled for a sole operator. Decide before phase F2.
- **Licence validation:** periodic online check with a **72-hour offline grace
  period**. Expiry never interrupts a running print and never deletes data.

## 7. Roadmap

| Phase | Scope |
| ----- | ----- |
| **F0 — Foundation** | Monorepo, CI, Docker Compose, PostgreSQL, authentication and users, module SDK skeleton, docs |
| **F1 — Core (Free)** | ✅ Moonraker driver, live status, printer control + console; ✅ first-run wizard (usage mode, first printer); ✅ single-printer and fleet views (cards / compact / list, groups, tags, filters); ✅ configurable sidebar, light/dark theme, user management, Ctrl+K palette; ✅ stage A printer page (webcam, temperatures, motion, tuning, files, history, console, macros). Next: stage B, spools + Spoolman import, job costing, simple orders |
| **F2 — Licensing + Pro** | `printrio-licensing` service, activation, signed module delivery; Pro: fleet queue, auto-assignment, orders+, notifications |
| **F3 — Beta for the waitlist** | Backups/export, update mechanism, onboarding, docs on printrio.app |
| **Later** | Automations, Business module, PrusaLink / Bambu / OctoPrint drivers, AI failure detection, remote access relay |

MVP for the first waitlist beta = F0 + F1 + F2 + F3.
