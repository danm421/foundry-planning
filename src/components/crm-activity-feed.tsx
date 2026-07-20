"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AlertCircleIcon } from "@/components/icons";
import type { FieldChange } from "@/lib/audit";
import { humanizeFieldName } from "@/lib/audit/labels";
import UpdateRowBody from "@/components/activity/update-row-body";

type ActivityKind =
  | "note"
  | "call"
  | "meeting"
  | "email"
  | "status_change"
  | "contact_change"
  | "account_change"
  | "document_uploaded"
  | "planning_link"
  | "relationship_change";

export type ActivityRow = {
  id: string;
  householdId: string;
  kind: ActivityKind;
  title: string;
  body: string | null;
  actorUserId: string | null;
  actor?: { name: string; isSystem: boolean };
  metadata?: { changes?: FieldChange[]; fields?: string[] } | null;
  occurredAt: string;
  createdAt: string;
};

const KIND_LABELS: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  status_change: "Status",
  contact_change: "Contact",
  account_change: "Account",
  document_uploaded: "Document",
  planning_link: "Planning",
  relationship_change: "Related household",
};

const PAGE_SIZE = 50;

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

function KindIcon({ kind }: { kind: ActivityKind }) {
  const base = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "call") {
    return (
      <svg {...base}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }
  if (kind === "meeting") {
    return (
      <svg {...base}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (kind === "email") {
    return (
      <svg {...base}>
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    );
  }
  if (kind === "status_change") {
    return (
      <svg {...base}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    );
  }
  if (kind === "contact_change") {
    return (
      <svg {...base}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </svg>
    );
  }
  if (kind === "account_change") {
    return (
      <svg {...base}>
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    );
  }
  if (kind === "document_uploaded") {
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  if (kind === "planning_link") {
    return (
      <svg {...base}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  // Default: note
  return (
    <svg {...base}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="14" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}

export type ActivityFeedHandle = {
  reload: () => void;
};

interface Props {
  householdId: string;
  /** Imperative handle so parent (the tab) can trigger a reload after posting. */
  handleRef?: React.Ref<ActivityFeedHandle>;
}

export function CrmActivityFeed({ householdId, handleRef }: Props) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/crm/households/${householdId}/activity?limit=${PAGE_SIZE}&offset=0`,
        { signal: ctrl.signal, cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Failed to load activity (${res.status})`);
      const j = (await res.json()) as { activity: ActivityRow[] };
      setRows(j.activity ?? []);
      setOffset(j.activity?.length ?? 0);
      setHasMore((j.activity?.length ?? 0) >= PAGE_SIZE);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useImperativeHandle(handleRef, () => ({ reload }), [reload]);

  useEffect(() => {
    reload();
    return () => {
      abortRef.current?.abort();
    };
  }, [reload]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/crm/households/${householdId}/activity?limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Failed to load more (${res.status})`);
      const j = (await res.json()) as { activity: ActivityRow[] };
      const next = j.activity ?? [];
      setRows((r) => [...r, ...next]);
      setOffset((o) => o + next.length);
      setHasMore(next.length >= PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && rows.length === 0) {
    return <div className="text-[13px] text-ink-3">Loading activity…</div>;
  }

  if (error && rows.length === 0) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
      >
        <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
        <p className="text-[13px] text-ink-3">No activity yet.</p>
        <p className="mt-1 text-[12px] text-ink-3">
          Use the buttons above to log a call, note, meeting, or email.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-3 rounded-[var(--radius)] border border-hair bg-card p-3.5 transition-colors hover:border-hair-2"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
              <KindIcon kind={row.kind} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[13.5px] font-semibold text-ink">
                  {row.title}
                </p>
                <time
                  dateTime={row.occurredAt}
                  title={new Date(row.occurredAt).toLocaleString()}
                  className="shrink-0 text-[11.5px] tabular-nums text-ink-3"
                >
                  {relativeTime(row.occurredAt)}
                </time>
              </div>
              {row.body && (
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
                  {row.body}
                </p>
              )}
              {Array.isArray(row.metadata?.changes) && row.metadata.changes.length ? (
                <div className="mt-1.5">
                  <UpdateRowBody changes={row.metadata.changes} />
                </div>
              ) : Array.isArray(row.metadata?.fields) && row.metadata.fields.length ? (
                // Legacy rows (pre-diff) stored field names only — never values,
                // so they cannot be backfilled into a before → after view.
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                  Changed: {row.metadata.fields.map(humanizeFieldName).join(", ")}
                </p>
              ) : null}
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                <span className="rounded-full bg-card-2 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                  {KIND_LABELS[row.kind]}
                </span>
                <span>by {row.actor?.name ?? "System"}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
