import type { RecordedJobStatus } from "@printrio/shared";

/** Recorded job status → existing state colours (accent / green / muted / red / amber). */
export const JOB_STATUS_CLASS: Record<RecordedJobStatus, string> = {
  printing: "state-printing",
  completed: "state-idle",
  cancelled: "state-offline",
  error: "state-error",
  interrupted: "state-paused",
};

export type CostPeriod = "month" | "30d" | "year" | "all";

/** Start of a reporting period, or undefined for all time. */
export function periodStart(period: CostPeriod, now = new Date()): Date | undefined {
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  return undefined;
}
