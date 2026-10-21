/** What the instance runs and the newest release (Settings → Backups → Updates, admin banner). */
export interface UpdateInfoDto {
  current: string;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  updateAvailable: boolean;
  /** UPDATE_CHECK=false, or a development build. */
  checking: boolean;
  checkedAt: string | null;
}
