import { Readable } from "node:stream";
import type { Webcam } from "@printrio/sdk";
import type { TemperatureHistoryDto, WebcamDto } from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
const webcamParams = z.object({ id: z.uuid(), index: z.coerce.number().int().min(0).max(32) });
const UPSTREAM_CONNECT_TIMEOUT_MS = 6_000;

/** MJPEG streams are proxied; adaptive/WebRTC cameras fall back to polled snapshots when available. */
export function webcamMode(cam: Webcam): WebcamDto["mode"] {
  const mjpegServices = new Set(["mjpegstreamer", "uv4l-mjpeg", "ipstream"]);
  if (mjpegServices.has(cam.service) && cam.streamUrl) return "mjpeg";
  if (cam.snapshotUrl) return "snapshot";
  return "unsupported";
}

/**
 * Temperature history and webcams. Webcam media is streamed through the
 * Printrio server so it works behind authentication and when the browser
 * cannot reach the printer network directly (hosted Printrio over Tailscale).
 */
export function printerMediaRoutes(app: FastifyInstance, manager: PrinterManager) {
  const notConnected = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };

  app.get("/api/printers/:id/temperatures", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const history: TemperatureHistoryDto = await manager
        .connected(params.id)
        .getTemperatureHistory();
      return history;
    } catch (error) {
      return notConnected(reply, error);
    }
  });

  app.get("/api/printers/:id/webcams", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const webcams = await manager.connected(params.id).listWebcams();
      return {
        webcams: webcams.map(
          (cam, index): WebcamDto => ({
            index,
            name: cam.name,
            service: cam.service,
            mode: webcamMode(cam),
            flipHorizontal: cam.flipHorizontal,
            flipVertical: cam.flipVertical,
            rotation: cam.rotation,
          }),
        ),
      };
    } catch (error) {
      return notConnected(reply, error);
    }
  });

  for (const kind of ["stream", "snapshot"] as const) {
    app.get(
      `/api/printers/:id/webcams/:index/${kind}`,
      { preHandler: requireUser },
      async (request, reply) => {
        const params = parseOr400(reply, webcamParams.safeParse(request.params));
        if (!params) return;
        let cam: Webcam | undefined;
        try {
          cam = (await manager.connected(params.id).listWebcams())[params.index];
        } catch (error) {
          return notConnected(reply, error);
        }
        // Only URLs the printer itself reports are fetched; clients cannot choose the target.
        const target = kind === "stream" ? cam?.streamUrl : cam?.snapshotUrl;
        if (!target) return reply.code(404).send({ error: "Webcam not found." });

        const controller = new AbortController();
        const connectTimer = setTimeout(() => controller.abort(), UPSTREAM_CONNECT_TIMEOUT_MS);
        request.raw.on("close", () => controller.abort());
        let upstream: Response;
        try {
          upstream = await fetch(target, { signal: controller.signal });
        } catch {
          return reply.code(502).send({ error: "The webcam did not respond." });
        } finally {
          clearTimeout(connectTimer);
        }
        if (!upstream.ok || !upstream.body)
          return reply.code(502).send({ error: `The webcam answered ${upstream.status}.` });
        reply
          .header("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg")
          .header("Cache-Control", "no-store")
          .header("X-Content-Type-Options", "nosniff");
        return reply.send(
          Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
        );
      },
    );
  }
}
