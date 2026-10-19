import { workspaceSettingsUpdateSchema } from "@printrio/shared";
import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.ts";
import { getWorkspaceSettings, updateWorkspaceSettings } from "../settings.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";

export function settingsRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/settings", { preHandler: requireUser }, () => getWorkspaceSettings(db));

  app.patch("/api/settings", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, workspaceSettingsUpdateSchema.safeParse(request.body));
    if (!input) return;
    return updateWorkspaceSettings(db, input);
  });
}
