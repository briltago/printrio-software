import type { UpdateProgress } from "@printrio/sdk";
import type { PrinterStatusDto, RealtimeMessage } from "@printrio/shared";
import type { FastifyInstance } from "fastify";
import type { PrinterManager } from "../printers/manager.ts";
import { requireUser } from "./guards.ts";

/** Pushes printer status, console output, update progress and change notifications to signed-in browsers. */
export function realtimeRoutes(
  app: FastifyInstance,
  manager: PrinterManager,
  changes: EventTarget,
) {
  app.get("/api/ws", { websocket: true, preHandler: requireUser }, (socket, request) => {
    const isAdmin = request.user?.role === "admin";
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
    // Update logs (package names, git output) are for admins, who are the only ones allowed to update.
    const onUpdate = (printerId: string, progress: UpdateProgress) => {
      if (isAdmin) send({ type: "printer.update", printerId, ...progress });
    };
    const onChange = () => send({ type: "printers.changed" });
    const onJobs = () => send({ type: "jobs.changed" });
    manager.on("status", onStatus);
    manager.on("console", onConsole);
    manager.on("update", onUpdate);
    changes.addEventListener("change", onChange);
    changes.addEventListener("jobs", onJobs);
    socket.on("close", () => {
      manager.off("status", onStatus);
      manager.off("console", onConsole);
      manager.off("update", onUpdate);
      changes.removeEventListener("change", onChange);
      changes.removeEventListener("jobs", onJobs);
    });
  });
}
