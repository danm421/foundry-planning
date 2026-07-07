import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { ReviewTxn } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

// Presentational: DashboardGrid owns the queue state so the rail panel's
// "Mark as reviewed" and these checkmarks stay in sync.
export function TileToReview({
  items,
  count,
  error,
  onMarkReviewed,
  onOpen,
}: {
  items: ReviewTxn[];
  count: number;
  error: boolean;
  onMarkReviewed: (id: string) => void;
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <TileFrame title="Transactions to review" href="/portal/transactions" linkLabel="View all">
      {count === 0 ? (
        <p className="text-[13px] text-ink-3">You&apos;re all caught up.</p>
      ) : (
        <>
          <div className="mb-3 tabular text-[28px] font-semibold text-ink">{count}</div>
          <ul className="space-y-1">
            {items.map((t) => (
              <li key={t.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Mark as reviewed"
                  onClick={() => onMarkReviewed(t.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-hair text-ink-4 hover:border-accent hover:text-accent"
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
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
