/**
 * Days a soft-deleted household stays in the Trash before the daily purge
 * cron removes it permanently. Single source of truth shared by the cron,
 * the service layer, and the Trash-view UI copy.
 */
export const HOUSEHOLD_TRASH_RETENTION_DAYS = 60;

const DAY_MS = 86_400_000;

/**
 * Whole days remaining until `deletedAt` crosses the retention window.
 * Never negative.
 */
export function daysUntilPurge(deletedAt: Date | string): number {
  const deleted = typeof deletedAt === "string" ? new Date(deletedAt) : deletedAt;
  const purgeAt = deleted.getTime() + HOUSEHOLD_TRASH_RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / DAY_MS));
}
