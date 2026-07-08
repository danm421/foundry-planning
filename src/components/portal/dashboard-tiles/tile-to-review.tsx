import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { ReviewTxn } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

// Presentational: DashboardGrid owns the queue state so the rail panel's
// "Mark as reviewed" and these checkmarks stay in sync. Edit controls
// (checkboxes, mark-all) follow the same editEnabled gate as the transactions
// list — hidden when the advisor has turned off portal editing.
export function TileToReview({
  items,
  count,
  error,
  editEnabled,
  onMarkReviewed,
  onMarkAll,
  onOpen,
}: {
  items: ReviewTxn[];
  count: number;
  error: boolean;
  editEnabled: boolean;
  onMarkReviewed: (id: string) => void;
  onMarkAll: () => void;
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <TileFrame title="Transactions to review" href="/transactions" linkLabel="View all">
      {count === 0 ? (
        <p className="text-[13px] text-ink-3">You&apos;re all caught up.</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="tabular text-[28px] font-semibold text-ink">{count}</span>
            {editEnabled && (
              <button
                type="button"
                onClick={onMarkAll}
                className="rounded-md border border-hair px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-accent hover:text-accent"
              >
                Mark all reviewed
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {items.map((t) => (
              <li key={t.id} className="flex items-center gap-1.5">
                {editEnabled && (
                  <button
                    type="button"
                    aria-label="Mark as reviewed"
                    onClick={() => onMarkReviewed(t.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-hair text-transparent hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent"
                  >
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-card-2"
                >
                  <span className="min-w-0 truncate text-[13px] text-ink-2">{t.merchantName ?? t.name}</span>
                  <span className="tabular shrink-0 text-[13px] text-ink">{fmtUsd(t.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-[12px] text-crit">Couldn&apos;t save that. Try again.</p>}
        </>
      )}
    </TileFrame>
  );
}
