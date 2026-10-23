# Printrio Module Exception, version 1.0

SPDX identifier: `AdditionRef-Printrio-Module-Exception`

Additional permission under section 7 of the GNU Affero General Public License,
version 3 ("AGPL").

Copyright (C) 2026 Jakub Banci

## Definitions

- **"Printrio"**: the program in https://github.com/briltago/printrio-software,
  licensed under AGPL-3.0-only.
- **"Module Interface"**:
  (a) the files in `packages/sdk` (package `@printrio/sdk`);
  (b) the type declarations, schemas and constants of `packages/shared`
  (package `@printrio/shared`) that `packages/sdk` references or re-exports; and
  (c) the objects Printrio passes to a Module at run time through that
  interface — the `ModuleContext` given to a server module and the
  `WebModuleHost` given to a web module (including `host.React`,
  `host.jsxRuntime`, `host.query`, `host.components`, `host.format` and
  `host.api`) — and the Printrio HTTP APIs reachable through them.
- **"Module"**: a work that
  (1) is loaded and executed by Printrio's module loader, whether delivered as
  a signed bundle downloaded at run time or otherwise;
  (2) interacts with Printrio only through the Module Interface; and
  (3) contains no part of Printrio other than parts of the Module Interface
  needed to use it (such as type declarations, constants, or code a compiler
  generates from them).

## Permission

As a special exception, the copyright holders of Printrio give you permission
to combine Printrio with Modules, and to copy and convey a Module, in source or
object form, under terms of your choice, without the Module being subject to
the AGPL. The Module need not be included in the Corresponding Source of
Printrio. Printrio itself, and every modified version of it, remains under the
AGPL, including section 13.

This exception does not apply to works that modify Printrio or copy Printrio
code outside the Module Interface. If you modify Printrio, you may extend this
exception to your version, but you are not obliged to do so. If you do not wish
to do so, delete this exception statement from your version.
