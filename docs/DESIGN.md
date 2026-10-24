# Printrio interface design

How the web UI is organised and drawn. Read this before adding a page, a
settings tab or a module entry. Tokens and shared classes live in
`apps/web/src/styles.css`; shared React pieces in `apps/web/src/components.tsx`.
Pro and Business modules use the same classes (`btn`, `card`, `input`,
`badge`, `state-*`) and CSS variables, so a change here changes them too.

## Who uses it

People who run 3D printers: a hobbyist with one Klipper machine, a small
print shop with a farm, an office with operators and an administrator. They
open Printrio next to the printers, often on a phone or a tablet on the
workbench, to answer a few questions quickly:

1. Which printers are free, which are printing, which need me?
2. What is this printer doing, and can I act on it safely?
3. Where is the file I want, and can I start it on a free printer?
4. Which spool is loaded, and how much is left?
5. What did a print cost, and what was printed for whom?

Frequent and low-risk: checking status, starting a print, swapping a spool.
Rare and high-risk: emergency stop, deleting printers or files, editing the
Klipper configuration, restoring a backup. The interface keeps the frequent
work one step away and puts the risky work behind a deliberate second step.

## Visual direction

A calm, technical operations console. Dense enough to scan a farm at a
glance, quiet enough to leave on a screen all day.

- **Neutral graphite surfaces** with one violet accent taken from the logo.
  The accent marks primary actions, the current selection and focus. It is
  not a status colour.
- **Status has its own palette**, the same everywhere (printers, jobs,
  orders, spools): printing = blue, ready/completed = green, paused/
  interrupted/new = amber, error = red, offline/cancelled = grey. Status is
  always written as a word next to the colour, never colour alone.
- **Borders, not shadows.** Elevation is reserved for things that float
  (dialogs, the drawer, the command palette).
- **Small radii** (6 / 8 / 10 px) and compact controls (36 px desktop,
  44 px on touch).
- **Type**: the system sans for everything, tabular numerals for
  temperatures, times, weights and money, monospace only for G-code,
  positions and console output. Page titles are 24 px, section titles 15 px,
  body 14 px, metadata 12 px. No uppercase eyebrows above titles.
- **Icons** are one set of 24 × 24 stroke SVGs (1.8 px), not text glyphs.
- **Motion** only shows a change of state (progress, a drawer opening,
  a panel collapsing), 150–200 ms, and is off under
  `prefers-reduced-motion`.
- **Both themes are designed.** Dark is the default for a workshop screen;
  light is for offices and daylight. Every token has both values.

## Information architecture

The sidebar is the map of the product. Core sections and module sections
share four categories; the category says what kind of work it is, not which
plan it comes from.

| Category | Core | Pro | Business |
| --- | --- | --- | --- |
| Workshop | Printers, Print jobs, Library, Filament | | Stock |
| Production | Orders | Fleet queue, Production | |
| Sales | | Customers | Pipeline, CRM, Quotes, Invoices |
| Insights | Costs | Statistics | Sites |

Settings follow the same rule: grouped by what they configure.

| Group | Tabs |
| --- | --- |
| Workspace | General, Appearance, Sidebar |
| Printers & material | Printer groups, Slicer upload, Fleet queue (Pro), Spool tracking (Pro) |
| Team | Users, Single sign-on, Roles & audit (Business) |
| Sales | Invoicing, Price lists, E-shops (Business) |
| Alerts & integrations | Notifications (Pro), Escalation (Business), API & webhooks (Business) |
| Plan & data | Licence, Plan usage (Business), Backups |

Modules may name a group for their entries (`group` on nav items and
settings tabs); entries of older modules are placed by
`MODULE_NAV_GROUPS` / `MODULE_SETTINGS_GROUPS` in `apps/web/src/nav.ts`, and
unknown ones get a group of their own.

### Two kinds of files

*Library* (sidebar) is Printrio's own G-code store: upload once, print on
any printer. *Files on this printer* (printer page) is the printer's own
storage through Moonraker. They are different places with different
lifetimes, so both stay. The printer page can print straight from the
library, so nobody has to leave a printer to find a file.

### Jobs and costs

*Print jobs* lists every recorded print with its cost; *Costs* sums them by
period, printer and material. They are one area with two views, linked by
tabs at the top of both pages.

## Feature map

Where each capability lives after the redesign. Nothing was removed.

| Capability | Before | Now | Change |
| --- | --- | --- | --- |
| Fleet status, search, group/tag filter, three views | Printers | Printers | State filter shows counts (“Printing 2 · Ready 3 · Error 1”) |
| Add printer | Printers header, command palette | same | — |
| Printer status, job, pause/resume/cancel, emergency stop, object skip | Printer page | Printer page | Status in the header, breadcrumb instead of back link |
| Edit printer | Printer header | Printer header | — |
| Delete printer | Printer header (next to Edit) | Inside Edit, under a divider | Destructive action one deliberate step away |
| Temperatures, toolhead, tuning, fans, power, macros, console, webcam | Printer page panels | same | — |
| Files on the printer: browse, upload, print, queue, delete | Printer page “Files” | Printer page “Files on this printer” | Readable on phones; print time in the row on small screens |
| Print a library file on this printer | Library → Send → choose printer | also Printer page → “From library” | New shortcut, same `/api/library/send` and queue endpoints |
| Per-printer queue | Printer page | same | — |
| Moonraker history, reprint | Printer page | same | — |
| Bed mesh, config editor, logs, updates, system | Printer → Maintenance | same | — |
| Library: folders, upload, send/print, queue, download, delete | Files | Library | Renamed so it is not confused with files on a printer |
| Spools: weigh, edit, archive, delete, load into printer | Filament (cards) | Filament (list) | Denser list, low-stock filter |
| Filament products | Filament → Filaments tab | same | — |
| Spoolman import | Filament | same | — |
| Print jobs with cost, link to order | Print jobs | Print jobs | Tabs to Costs |
| Cost summary by period, printer, material | Costs | Costs | Tabs to Print jobs |
| Orders, order folders, order panels from modules | Orders | same | — |
| Settings tabs (core and modules) | Grouped by plan for modules | Grouped by purpose | See table above |
| Sidebar order, visibility, categories | Settings → Sidebar | same | Categories can be collapsed in the sidebar |
| Theme, language | Top bar, Settings → Appearance | Sidebar footer, Settings → Appearance | Desktop top bar removed |
| Account, sign out | Top bar (desktop), drawer (phone) | Sidebar footer (both) | One place on every screen size |
| Command palette | Sidebar search, Ctrl K | same | — |

## Not done yet

- *Customers* (Pro) and *CRM* (Business) show the same people in two
  places. Merging them needs an extension point in Pro's customer detail
  (a “customer panel” like `orderPanels`) so Business can add the timeline
  there; until then both stay.
- Confirmation of destructive actions still uses the browser's `confirm()`
  dialog. It is accessible and cannot be clicked through by accident, but it
  cannot explain consequences in detail.
