import type { ReactElement } from "react";
import type { AuditMetadata } from "@/lib/audit";
import type { HydratedActivityRow } from "./activity-page";
import CreateRowBody from "./create-row-body";
import UpdateRowBody from "./update-row-body";
import DeleteRowBody from "./delete-row-body";
import OtherRowBody from "./other-row-body";
import { formatAuditRow } from "@/lib/overview/format-audit";

interface Props {
  row: HydratedActivityRow;
}

export default function ActivityRow({ row }: Props): ReactElement {
  const meta = row.metadata as AuditMetadata | null;
  const kind = meta?.kind ?? "other";

  const glyph =
    kind === "create" ? "+" : kind === "delete" ? "×" : kind === "update" ? "↻" : "•";
  const verb = formatAuditRow({ action: row.action });

  return (
    <li className="flex flex-col gap-2 border-b border-hair py-4">
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span aria-hidden className="font-mono text-base text-ink-3">
            {glyph}
          </span>
          <p className="text-sm text-ink">
            <span className="font-medium">{row.actor.name}</span>
            <span className="text-ink-3"> · {verb.toLowerCase()}</span>
          </p>
        </div>
        <time
          dateTime={row.createdAt.toString()}
          title={new Date(row.createdAt).toLocaleString()}
          className="text-xs text-ink-3"
        >
          {formatRelative(row.createdAt)}
        </time>
      </header>
      <div className="pl-6">
        {meta?.kind === "create" ? (
          <CreateRowBody snapshot={meta.snapshot} resourceType={row.resourceType} />
        ) : meta?.kind === "delete" ? (
          <DeleteRowBody snapshot={meta.snapshot} resourceType={row.resourceType} />
        ) : meta?.kind === "update" ? (
          <UpdateRowBody changes={meta.changes} />
        ) : (
          <OtherRowBody metadata={meta} />
        )}
      </div>
    </li>
  );
}

function formatRelative(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  const ms = Date.now() - date.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (ms < 60 * 1000) return "just now";
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < sevenDays) return `${Math.floor(ms / 86_400_000)}d ago`;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
