# Printrio — notes for Claude

Read `docs/VISION.md` and `docs/ARCHITECTURE.md` before larger changes; they
record agreed product and architecture decisions. Update them when a decision changes.

## Ground rules
- This repo is the **open-source core** (AGPL). Never add Pro/Business feature
  code here — only extension points in `packages/sdk`. Pro/Business live in the
  private `printrio-pro` / `printrio-business` repos.
- Printer-specific code lives only in drivers implementing `PrinterDriver`.
- A licence expiry must never interrupt a running print or delete data.
- Shared request/response shapes go in `packages/shared` as Zod schemas.

## Conventions
- TypeScript, ESM, imports with explicit `.ts` extensions.
- Schema changes: edit `apps/server/src/db/schema.ts`, run `pnpm db:generate`,
  rename the migration to something descriptive (and in `drizzle/meta/_journal.json`).
- Server routes get integration tests in `apps/server/test` (Fastify `inject`
  against a real PostgreSQL test database).
- Before committing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
