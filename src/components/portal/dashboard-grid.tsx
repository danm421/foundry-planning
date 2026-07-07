"use client";
import { useCallback, useState, type ReactElement } from "react";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { PortalDetailPortal } from "@/components/portal/portal-detail-rail";
import { TileMonthlySpending } from "./dashboard-tiles/tile-monthly-spending";
import { TileNetWorth } from "./dashboard-tiles/tile-net-worth";
import { TileNetThisMonth } from "./dashboard-tiles/tile-net-this-month";
import { TileToReview } from "./dashboard-tiles/tile-to-review";
import { TileTopCategories } from "./dashboard-tiles/tile-top-categories";
import { TileNextTwoWeeks } from "./dashboard-tiles/tile-next-two-weeks";
import { NotSharedNotice } from "./not-shared-notice";
import {
  DashboardDetailPanel,
  type DashboardDetailPayload,
} from "./dashboard-detail-panel";

export function DashboardGrid({
  dto,
  editEnabled,
}: {
  dto: PortalDashboardDTO;
  editEnabled: boolean;
}): ReactElement {
  const { sharing } = dto;
  const portalFetch = usePortalFetch();
  const [detail, setDetail] = useState<DashboardDetailPayload | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);

  // The to-review queue lives here (not in the tile) so the tile's checkmarks
  // and the rail panel's "Mark as reviewed" stay in sync.
  const [reviewItems, setReviewItems] = useState(dto.toReview.sample);
  const [reviewCount, setReviewCount] = useState(dto.toReview.count);
  const [reviewError, setReviewError] = useState(false);

  const markReviewed = useCallback(
    async (id: string): Promise<void> => {
      setReviewError(false);
      const prevItems = reviewItems;
      const prevCount = reviewCount;
      setReviewItems((xs) => xs.filter((t) => t.id !== id));
      setReviewCount((c) => Math.max(0, c - 1));
      setDetail((d) => (d?.kind === "transaction" && d.id === id ? null : d));
      try {
        const res = await portalFetch(`/api/portal/transactions/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewed: true }),
        });
        if (!res.ok) {
          setReviewItems(prevItems);
          setReviewCount(prevCount);
          setReviewError(true);
        }
      } catch {
        setReviewItems(prevItems);
        setReviewCount(prevCount);
        setReviewError(true);
      }
    },
    [reviewItems, reviewCount, portalFetch],
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-testid="dashboard-grid">
        {sharing.shareBudgets ? (
          <TileMonthlySpending
            spending={dto.spending}
            onOpen={() => setDetail({ kind: "spending" })}
          />
        ) : (
          <NotSharedNotice area="budgets" variant="tile" />
        )}
        <TileNetWorth netWorth={dto.netWorth} onOpen={() => setDetail({ kind: "networth" })} />
        {sharing.shareTransactions ? (
          <TileToReview
            items={reviewItems}
            count={reviewCount}
            error={reviewError}
            onMarkReviewed={(id) => void markReviewed(id)}
            onOpen={(id) => setDetail({ kind: "transaction", id })}
          />
        ) : (
          <NotSharedNotice area="transactions" variant="tile" />
        )}
        {sharing.shareBudgets ? (
          <TileTopCategories
            topCategories={dto.topCategories}
            onOpen={(categoryId, name) => setDetail({ kind: "category", categoryId, name })}
          />
        ) : (
          <NotSharedNotice area="budgets" variant="tile" />
        )}
        {sharing.shareTransactions ? (
          <TileNetThisMonth netThisMonth={dto.netThisMonth} />
        ) : (
          <NotSharedNotice area="transactions" variant="tile" />
        )}
        {sharing.shareRecurrings ? (
          <TileNextTwoWeeks
            recurrings={dto.recurrings}
            onOpen={(id) => setDetail({ kind: "recurring", id })}
          />
        ) : (
          <NotSharedNotice area="recurrings" variant="tile" />
        )}
      </div>
      {detail && (
        <PortalDetailPortal closeLabel="Close details" onClose={closeDetail}>
          <DashboardDetailPanel
            payload={detail}
            dto={dto}
            reviewItems={reviewItems}
            editEnabled={editEnabled}
            onOpenCategory={(categoryId, name) =>
              setDetail({ kind: "category", categoryId, name })
            }
            onMarkReviewed={(id) => void markReviewed(id)}
            onClose={closeDetail}
          />
        </PortalDetailPortal>
      )}
    </>
  );
}
