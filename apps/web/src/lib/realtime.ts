import { type Printer, type RealtimeMessage, realtimeMessageSchema } from "@printrio/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { groupsQuery, printersQuery } from "./queries.ts";

const MAX_CONSOLE_LINES = 300;
const consoleLines = new Map<string, string[]>();
const consoleListeners = new Set<() => void>();

export function appendConsole(printerId: string, line: string) {
  const lines = [...(consoleLines.get(printerId) ?? []), line].slice(-MAX_CONSOLE_LINES);
  consoleLines.set(printerId, lines);
  for (const listener of consoleListeners) listener();
}

const EMPTY: string[] = [];
export function useConsole(printerId: string) {
  return useSyncExternalStore(
    (listener) => {
      consoleListeners.add(listener);
      return () => consoleListeners.delete(listener);
    },
    () => consoleLines.get(printerId) ?? EMPTY,
  );
}

function handle(queryClient: QueryClient, message: RealtimeMessage) {
  if (message.type === "printers.changed") {
    void queryClient.invalidateQueries({ queryKey: printersQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: groupsQuery.queryKey });
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
  } else if (message.type === "printer.console") {
    appendConsole(message.printerId, message.line);
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
