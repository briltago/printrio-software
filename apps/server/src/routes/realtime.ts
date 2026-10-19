import type { PrinterStatusDto, RealtimeMessage } from "@printrio/shared";
import type { FastifyInstance } from "fastify";
import type { PrinterManager } from "../printers/manager.ts";
import { requireUser } from "./guards.ts";

/** Pushes printer status, console output and change notifications to signed-in browsers. */
export function realtimeRoutes(
  app: FastifyInstance,
  manager: PrinterManager,
  changes: EventTarget,
) {
  app.get("/api/ws", { websocket: true, preHandler: requireUser }, (socket) => {
    const send = (message: RealtimeMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    for (const [printerId, status] of Object.entries(manager.snapshot())) {
      send({ type: "printer.status", printerId, status });
    }
    const onStatus = (printerId: string, status: PrinterStatusDto) =>
      send({ type: "printer.status", printerId, status });
    const onConsole = (printerId: string, line: string) =>
      send({ type: "printer.console", printerId, line });
    const onChange = () => send({ type: "printers.changed" });
    manager.on("status", onStatus);
    manager.on("console", onConsole);
    changes.addEventListener("change", onChange);
    socket.on("close", () => {
      manager.off("status", onStatus);
      manager.off("console", onConsole);
      changes.removeEventListener("change", onChange);
    });
  });
}
