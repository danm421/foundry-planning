// mobile/src/ui/date.ts
//
// Day-only date formatting for transaction lists.

/** "2026-06-12" -> "Jun 12". UTC-pinned so the day never shifts across
 *  timezones (mirrors src/lib/portal/format.ts fmtDay on the web portal). */
export function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
