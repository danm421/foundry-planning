import { formatAuditRow } from "@/lib/overview/format-audit";
import type { AuditRowSummary } from "@/lib/overview/list-audit-rows";

function relativeTime(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function RecentActivityPanel({ rows }: { rows: AuditRowSummary[] }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Recent activity</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No activity yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3">
              <span className="text-gray-200">{formatAuditRow(r)}</span>
              <span className="text-xs text-gray-500">{relativeTime(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
