export function formatDueDate(
  due: string | null,
  now: Date = new Date(),
): { label: string; overdue: boolean } {
  if (!due) return { label: "—", overdue: false };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const d = new Date(`${due}T00:00:00Z`);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return { label: "today", overdue: false };
  if (diff === 1) return { label: "tomorrow", overdue: false };
  if (diff > 1 && diff <= 14) return { label: `in ${diff}d`, overdue: false };
  if (diff < 0) return { label: `${-diff}d ago`, overdue: true };
  return {
    label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    overdue: false,
  };
}
