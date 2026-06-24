import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

export function TileToReview({
  toReview,
  onOpen,
}: {
  toReview: PortalDashboardDTO["toReview"];
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <TileFrame title="Transactions to review" href="/portal/transactions" linkLabel="View all">
      {toReview.count === 0 ? (
        <p className="text-[13px] text-ink-3">Everything&apos;s categorized.</p>
      ) : (
        <>
          <div className="mb-3 tabular text-[28px] font-semibold text-ink">
            {toReview.count}
          </div>
          <ul className="space-y-1">
            {toReview.sample.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-card-2"
                >
                  <span className="min-w-0 truncate text-[13px] text-ink-2">
                    {t.merchantName ?? t.name}
                  </span>
                  <span className="tabular shrink-0 text-[13px] text-ink">{fmtUsd(t.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </TileFrame>
  );
}
