# Contributing to Printrio

Thanks for helping. Bug reports and feature requests are welcome as
[GitHub issues](https://github.com/briltago/printrio-software/issues); please
include your Printrio version (bottom of the sidebar) and, for printer problems, the
Moonraker version. Security issues: see [SECURITY.md](SECURITY.md).

## Pull requests

- Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before opening one
  (see the README for the development setup).
- Printer-specific code belongs in drivers implementing `PrinterDriver`.
- Request and response shapes shared by server, web and modules go in
  `packages/shared` as Zod schemas; UI text goes through `useT()` with English,
  Czech and German entries.
- Pro and Business features are not part of this repository; extension points
  for modules go in `packages/sdk`.

## Licensing

Printrio is licensed under the GNU AGPL-3.0-only with the Printrio Module
Exception. Before your first pull request is merged, you must agree to the
[Contributor License Agreement](CLA.md) by ticking the box in the pull request
template. Your contribution is licensed under the same terms.
