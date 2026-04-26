import type { ReactElement } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/card";
import SectionMarker from "@/components/section-marker";
import { formatAuditRow } from "@/lib/overview/format-audit";
import type { AuditRowSummary } from "@/lib/overview/list-audit-rows";

interface Props {
  clientId: string;
  rows: AuditRowSummary[];
}

function relativeTime(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ACTION_GLYPH_CLASS: Record<string, string> = {
  create: "bg-good/20 text-good",
  update: "bg-cat-portfolio/20 text-cat-portfolio",
  complete: "bg-good/20 text-good",
  run: "bg-cat-life/20 text-cat-life",
  delete: "bg-crit/20 text-crit",
};

const ACTION_GLYPH_CHAR: Record<string, string> = {
  create: "+",
  update: "↻",
  complete: "✓",
  run: "▶",
  delete: "×",
};

function glyphClass(action: string | null | undefined): string {
  if (!action) return "bg-card-2 text-ink-3";
  return ACTION_GLYPH_CLASS[action] ?? "bg-card-2 text-ink-3";
}

function glyphChar(action: string | null | undefined): string {
  if (!action) return "·";
  return ACTION_GLYPH_CHAR[action] ?? "·";
}

export default function RecentActivityPanel({ clientId, rows }: Props): ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <SectionMarker num="08" label="Recent activity" />
          <Link
            href={`/clients/${clientId}/activity`}
            className="text-[14px] font-semibold text-ink underline-offset-2 hover:underline"
          >
            Recent activity
          </Link>
        </div>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-3">No activity yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-x-6">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 text-[13px]">
                <span
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm font-mono text-[12px] ${glyphClass(r.action)}`}
                  aria-hidden
                >
                  {glyphChar(r.action)}
                </span>
                <span className="flex-1 text-ink-2">{formatAuditRow(r)}</span>
                <span className="tabular font-mono text-xs text-ink-4">
                  {relativeTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
