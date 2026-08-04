"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import type { InboxRow } from "@/lib/notifications/queries";
import { markReadAction } from "@/app/(app)/alerts/actions";

function relativeTime(d: Date, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function InboxList({ rows }: { rows: InboxRow[] }): ReactElement {
  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card px-6 py-10 text-center text-[14px] text-ink-3">
        Nothing here yet. Alerts about your book land in this list.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hair rounded-[var(--radius-sm)] border border-hair bg-card">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={row.url}
            // Read state changes on CLICK only. Auto-marking everything read on
            // page view would destroy the unread signal the sidebar badge
            // depends on — you would open the page once and lose the list.
            onClick={() => {
              if (!row.readAt) void markReadAction(row.id);
            }}
            className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {row.readAt ? (
              // Layout-only spacer so read and unread titles share a left edge.
              <span aria-hidden className="mt-[6px] h-2 w-2 shrink-0" />
            ) : (
              <span
                data-testid="unread-dot"
                className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-accent"
              >
                {/* Unread state must not be carried by color alone. Real text
                    rather than aria-label: a bare span has no role, so its
                    aria-label is not reliably exposed. */}
                <span className="sr-only">Unread</span>
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink" title={row.title}>
                {row.title}
              </span>
              {row.body ? (
                <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                  {row.body}
                </span>
              ) : null}
            </span>
            {/* The label is relative to render time, so the server's HTML and
                the hydrating client can straddle a minute boundary and disagree.
                suppressHydrationWarning makes React skip the text comparison
                entirely: it neither warns nor patches, so the SERVER's label
                sticks until this subtree next renders. That is the intended
                trade — a label at most one bucket stale beats a hydration error
                on every boundary crossing. dateTime is derived from the fixed
                Date, so it is identical on both sides regardless. */}
            <time
              dateTime={row.createdAt.toISOString()}
              suppressHydrationWarning
              className="tabular mt-[3px] shrink-0 text-[12px] text-ink-4"
            >
              {relativeTime(row.createdAt)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
