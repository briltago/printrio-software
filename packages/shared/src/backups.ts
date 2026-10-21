import { z } from "zod";

export const BACKUP_KINDS = ["manual", "scheduled", "pre-update", "uploaded"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Automatic backups (Settings → Backups). */
export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Hour of the day (server time) for the daily backup. */
  hour: z.number().int().min(0).max(23),
  /** Daily backups to keep. */
  keep: z.number().int().min(1).max(90),
  /** Include the G-code library (can be large). */
  includeFiles: z.boolean(),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export interface BackupDto {
  name: string;
  kind: BackupKind;
  version: string;
  createdAt: string;
  size: number;
}

export interface BackupsDto {
  backups: BackupDto[];
  settings: BackupSettings;
  /** pg_dump/psql present (always in the Docker image). */
  available: boolean;
  directory: string;
}
