# Printrio — Design system

One visual language for every Printrio surface: the marketing site
(`printrio-website`), its Worker pages (waitlist confirmation/unsubscribe) and
the self-hosted app (`apps/web`). The app should look like the workspace
preview on printrio.app.

Source of truth for tokens:
- app: `apps/web/src/styles.css` (`@theme`)
- website: `printrio-website/assets/styles.css` (`:root`)

Change a token in both places.

## Colour

| Token          | Value     | Use |
| -------------- | --------- | --- |
| `bg`           | `#09070f` | Page background |
| `surface`      | `#12101b` | Cards, panels |
| `surface-2`    | `#191524` | Raised elements inside cards |
| `sidebar`      | `#0d0a14` | App sidebar, input backgrounds |
| `line`         | `#292337` | Borders, dividers |
| `line-strong`  | `#39304a` | Input borders |
| `text`         | `#f5f3fa` | Primary text |
| `muted`        | `#b0a9bc` | Secondary text |
| `subtle`       | `#7c7686` | Labels, metadata |
| `accent`       | `#a78bfa` | Primary actions, active state, progress |
| `accent-2`     | `#c4b5fd` | Kickers, links, focus ring |
| `accent-ink`   | `#100b1b` | Text on accent backgrounds |
| `success`      | `#75e0b1` | Status only (printer ready, stock OK) |
| `danger`       | `#ff8a9b` | Errors |

Neutrals carry a slight lavender tint — never green or blue-grey. Green is
reserved for status.

## Type

- Sans: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` — no web fonts, no third-party font requests.
- Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — labels in previews, code.
- Headings: semibold, tight tracking (`-0.03em` … `-0.06em` for large numbers).
- Kicker: 11px, bold, uppercase, `0.15em` tracking, `accent-2`.
- Wordmark: lowercase "printrio", bold, `-0.8px` tracking, next to the logo (`logo.webp`).

## Shape and components

| Element   | Spec |
| --------- | ---- |
| Button    | radius 11px, 13px bold, padding 11–12px × 17px. Primary: `accent` bg, `accent-ink` text, soft accent shadow. Secondary: transparent, `line` border |
| Input     | radius 10px, `#0d0a14` bg, `line-strong` border, accent border + 4px accent halo on focus |
| Card      | radius 14px, `surface` bg, `line` border; auth/standalone cards radius 16px |
| Nav item  | radius 8px; active = accent 10% bg, accent 20% border, `text` colour |
| Focus     | 2px `accent-2` outline, 3px offset — on every interactive element |

Respect `prefers-reduced-motion`: no hover lifts or decorative animation.
