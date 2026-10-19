import {
  DEFAULT_SETTINGS,
  type WorkspaceSettings,
  type WorkspaceSettingsUpdate,
  workspaceSettingsSchema,
} from "@printrio/shared";
import { eq } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import { instanceSettings } from "./db/schema.ts";

const KEY = "workspace";

export async function getWorkspaceSettings(db: Database): Promise<WorkspaceSettings> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, KEY));
  if (!row) return DEFAULT_SETTINGS;
  // Merge over defaults so settings stored by older versions stay valid when fields are added.
  const parsed = workspaceSettingsSchema.safeParse({
    ...DEFAULT_SETTINGS,
    ...JSON.parse(row.value),
  });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function updateWorkspaceSettings(db: Database, update: WorkspaceSettingsUpdate) {
  const next = workspaceSettingsSchema.parse({ ...(await getWorkspaceSettings(db)), ...update });
  const value = JSON.stringify(next);
  await db
    .insert(instanceSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } });
  return next;
}
