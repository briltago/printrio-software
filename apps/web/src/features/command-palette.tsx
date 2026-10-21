import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { printersQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { useSidebar } from "../lib/sidebar.ts";
import { nextTheme, setTheme, useTheme } from "../lib/theme.ts";

interface Command {
  id: string;
  group: string;
  label: string;
  run: () => void;
}

/** Ctrl/Cmd+K: jump to pages and printers, run quick actions. */
export function CommandPalette({ onAddPrinter }: { onAddPrinter: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: me } = useSuspenseQuery(meQuery);
  const { entries: sidebar } = useSidebar();
  const { data: printerData } = useQuery(printersQuery);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("printrio:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("printrio:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate({ to });
    const pages: Command[] = sidebar
      .filter((entry) => entry.visible)
      .map((entry) => ({
        id: `page-${entry.id}`,
        group: t("palette.pages"),
        label: entry.label,
        run:
          "to" in entry.link
            ? go(entry.link.to)
            : () => {
                const { moduleId, path } = entry.link as { moduleId: string; path: string };
                void navigate({ to: "/m/$moduleId/$", params: { moduleId, _splat: path } });
              },
      }));
    pages.push({
      id: "page-settings",
      group: t("palette.pages"),
      label: t("nav.settings"),
      run: go("/settings"),
    });
    const printers: Command[] = (printerData?.printers ?? []).map((printer) => ({
      id: `printer-${printer.id}`,
      group: t("palette.printers"),
      label: printer.name,
      run: () => void navigate({ to: "/printers/$printerId", params: { printerId: printer.id } }),
    }));
    const actions: Command[] = [
      {
        id: "theme",
        group: t("palette.actions"),
        label: t("palette.toggleTheme"),
        run: () => setTheme(nextTheme(theme)),
      },
    ];
    if (me?.role === "admin")
      actions.unshift({
        id: "add-printer",
        group: t("palette.actions"),
        label: t("printer.add"),
        run: onAddPrinter,
      });
    return [...printers, ...pages, ...actions];
  }, [sidebar, printerData, me, theme, t, navigate, onAddPrinter]);

  const results = commands.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(results[active]);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; keyboard users close with Escape (native <dialog>).
    <dialog
      ref={dialogRef}
      className="dialog mt-[12vh] mb-auto"
      aria-label={t("palette.placeholder")}
      onClose={() => setOpen(false)}
      onClick={(event) => event.target === dialogRef.current && setOpen(false)}
    >
      {open && (
        <div>
          <input
            className="w-full border-line border-b bg-transparent px-5 py-4 outline-none"
            placeholder={t("palette.placeholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          />
          <div id={listId} role="listbox" className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-subtle">{t("palette.empty")}</p>
            )}
            {results.map((command, index) => (
              // Focus stays in the combobox input (aria-activedescendant); options are not tab stops.
              <div
                key={command.id}
                id={`${listId}-${command.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(command)}
                onKeyDown={() => {}}
                className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm ${index === active ? "bg-accent/15 text-text" : "text-muted"}`}
              >
                <span className="truncate">{command.label}</span>
                <span className="ml-3 text-xs text-subtle">{command.group}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}
