import { type Printer, type RealtimeMessage, realtimeMessageSchema } from "@printrio/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { groupsQuery, printersQuery, settingsQuery } from "./queries.ts";

export interface ConsoleLine {
  kind: "command" | "response";
  message: string;
}

const MAX_CONSOLE_LINES = 500;
const consoleLines = new Map<string, ConsoleLine[]>();
const consoleListeners = new Set<() => void>();
const notifyConsole = () => {
  for (const listener of consoleListeners) listener();
};

export function appendConsole(printerId: string, line: ConsoleLine) {
  const lines = [...(consoleLines.get(printerId) ?? []), line].slice(-MAX_CONSOLE_LINES);
  consoleLines.set(printerId, lines);
  notifyConsole();
}

/** Replaces the buffer with the printer's backlog (which already contains everything streamed so far). */
export function seedConsole(printerId: string, lines: ConsoleLine[]) {
  consoleLines.set(printerId, lines.slice(-MAX_CONSOLE_LINES));
  notifyConsole();
}

export function clearConsole(printerId: string) {
  consoleLines.set(printerId, []);
  notifyConsole();
}

const EMPTY: ConsoleLine[] = [];
export function useConsole(printerId: string) {
  return useSyncExternalStore(
    (listener) => {
      consoleListeners.add(listener);
      return () => consoleListeners.delete(listener);
    },
    () => consoleLines.get(printerId) ?? EMPTY,
  );
}

export interface UpdateLine {
  application: string;
  message: string;
  complete: boolean;
}

const MAX_UPDATE_LINES = 500;
const updateLines = new Map<string, UpdateLine[]>();
const updateListeners = new Set<() => void>();
const notifyUpdates = () => {
  for (const listener of updateListeners) listener();
};

export function clearUpdateLog(printerId: string) {
  updateLines.set(printerId, []);
  notifyUpdates();
}

const NO_UPDATES: UpdateLine[] = [];
/** Progress output of software updates on a printer host (admins only receive it). */
export function useUpdateLog(printerId: string) {
  return useSyncExternalStore(
    (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    () => updateLines.get(printerId) ?? NO_UPDATES,
  );
}

function handle(queryClient: QueryClient, message: RealtimeMessage) {
  if (message.type === "printers.changed") {
    void queryClient.invalidateQueries({ queryKey: printersQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: groupsQuery.queryKey });
    // Also sent when the licence changes (limits, loaded modules).
    void queryClient.invalidateQueries({ queryKey: ["licence"] });
    void queryClient.invalidateQueries({ queryKey: ["modules"] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    // Modules may adopt workspace settings (the low-stock threshold) and report it as a change.
    void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
  } else if (message.type === "printer.status") {
    queryClient.setQueryData(printersQuery.queryKey, (data) =>
      data
        ? {
            ...data,
            printers: data.printers.map((printer: Printer) =>
              printer.id === message.printerId ? { ...printer, status: message.status } : printer,
            ),
          }
        : data,
    );
  } else if (message.type === "jobs.changed") {
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["costs"] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
  } else if (message.type === "queue.changed") {
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
  } else if (message.type === "printer.update") {
    const { printerId, application, message: text, complete } = message;
    updateLines.set(
      printerId,
      [...(updateLines.get(printerId) ?? []), { application, message: text, complete }].slice(
        -MAX_UPDATE_LINES,
      ),
    );
    notifyUpdates();
    if (complete) void queryClient.invalidateQueries({ queryKey: ["updates", printerId] });
  } else if (message.type === "printer.console") {
    appendConsole(message.printerId, { kind: "response", message: message.line });
  }
}

/** Keeps printer status live over /api/ws; reconnects with backoff while mounted. */
export function useRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      const url = new URL("/api/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        attempt = 0;
        void queryClient.invalidateQueries({ queryKey: printersQuery.queryKey });
      });
      socket.addEventListener("message", (event) => {
        const parsed = realtimeMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (parsed.success) handle(queryClient, parsed.data);
      });
      socket.addEventListener("close", () => {
        if (stopped) return;
        retry = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt++));
      });
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [queryClient]);
}
