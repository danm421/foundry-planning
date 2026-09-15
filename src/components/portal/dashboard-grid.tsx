"use client";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { PortalDashboardDTO, ReviewTxn } from "@/lib/portal/load-dashboard";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { CategoryRow } from "@/components/portal/category-combobox";
import { PortalDetailPortal } from "@/components/portal/portal-detail-rail";
import { TileMonthlySpending } from "./dashboard-tiles/tile-monthly-spending";
import { TileNetWorth } from "./dashboard-tiles/tile-net-worth";
import { TileGoalsFunded } from "./dashboard-tiles/tile-goals-funded";
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
  /**
   * `budgetEnabled` is the advisor's Budget switch, read off the DTO because
   * the loader that skipped the queries is the same one that reports it. Off
   * drops the five budgeting tiles entirely (not a NotSharedNotice — that says
   * "you chose to hide this from your advisor", the opposite direction): each
   * one links into `/budget/*`, which 404s for this client.
   */
  const { sharing, budgetEnabled } = dto;
  const portalFetch = usePortalFetch();
  const [detail, setDetail] = useState<DashboardDetailPayload | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);

  // The to-review queue lives here (not in the tile) so the tile's checkmarks
  // and the rail panel's "Mark as reviewed" stay in sync.
  const [reviewItems, setReviewItems] = useState(dto.toReview.sample);
  const [reviewCount, setReviewCount] = useState(dto.toReview.count);
  /**
   * A queue write that didn't save, by the rows it failed for. The tile prints
   * one line for any failure; the rail prints it only for the row it has open,
   * so a failed pick on one row can't read as an error about another.
   */
  const [failedIds, setFailedIds] = useState<string[] | null>(null);

  /**
   * Categories for the to-review pickers — the tile's and the rail panel's.
   * Loaded here so both read one list, and only when there is a picker to
   * fill: a read-only queue renders plain pills, a hidden tile has no rows,
   * and a caught-up client has nothing to categorize.
   */
  const showToReview = budgetEnabled && sharing.shareTransactions;
  const needCategories = editEnabled && showToReview && reviewItems.length > 0;
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  useEffect(() => {
    if (!needCategories) return;
    let live = true;
    void portalFetch("/api/portal/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d: { categories: CategoryRow[] }) => {
        if (live) setCategories(d.categories ?? []);
      })
      .catch(() => {
        if (live) setCategories([]);
      });
    return () => {
      live = false;
    };
  }, [needCategories, portalFetch]);

  // Undoing an optimistic write is the same three moves everywhere: put the
  // rows back, put the count back, say which rows didn't save.
  const revertTo = useCallback(
    (items: ReviewTxn[], count: number, ids: string[]) => () => {
      setReviewItems(items);
      setReviewCount(count);
      setFailedIds(ids);
    },
    [],
  );

  // Both the refill GET and the batch POST answer with the same page shape —
  // one reader so they can't drift apart. A response missing either field
  // leaves that half of the optimistic state alone.
  const applyQueuePage = useCallback((data: { items?: ReviewTxn[]; count?: number }) => {
    if (Array.isArray(data.items)) setReviewItems(data.items);
    if (typeof data.count === "number") setReviewCount(data.count);
  }, []);

  // Pulls the next page after a single checkmark so the tile stays full while
  // the backlog drains. A failed refill keeps the optimistic queue — the count
  // is still right, there are just fewer rows on screen until the next load.
  const refillQueue = useCallback(async (): Promise<void> => {
    try {
      const res = await portalFetch(`/api/portal/transactions/review-queue`);
      if (!res.ok) return;
      applyQueuePage((await res.json()) as { items?: ReviewTxn[]; count?: number });
    } catch {
      /* keep what the optimistic update left on screen */
    }
  }, [portalFetch, applyQueuePage]);

  const markReviewed = useCallback(
    async (id: string): Promise<void> => {
      setFailedIds(null);
      const revert = revertTo(reviewItems, reviewCount, [id]);
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
          revert();
          return;
        }
        void refillQueue();
      } catch {
        revert();
      }
    },
    [reviewItems, reviewCount, portalFetch, refillQueue, revertTo],
  );

  // Marks only the rows on screen, then takes the next page straight off the
  // response — the client clears the backlog a page at a time rather than
  // blessing rows they never read. Reverts to the previous page on failure.
  const markPageReviewed = useCallback(async (): Promise<void> => {
    const ids = reviewItems.map((t) => t.id);
    if (ids.length === 0) return;
    setFailedIds(null);
    const revert = revertTo(reviewItems, reviewCount, ids);
    setReviewItems([]);
    setReviewCount((c) => Math.max(0, c - ids.length));
    setDetail((d) => (d?.kind === "transaction" && ids.includes(d.id) ? null : d));
    try {
      const res = await portalFetch(`/api/portal/transactions/review-queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        revert();
        return;
      }
      const data = (await res.json()) as { items?: ReviewTxn[]; count?: number };
      // A page with nothing left comes back as an empty list, so the marked
      // rows leave the tile even if the server omits `items`.
      applyQueuePage({ items: data.items ?? [], count: data.count });
    } catch {
      revert();
    }
  }, [reviewItems, reviewCount, portalFetch, applyQueuePage, revertTo]);

  // Recategorizing a queued row happens before it is blessed, so the row stays
  // in the queue — only its category changes. Optimistic like the marks above,
  // and it reverts through the same three moves.
  const pickCategory = useCallback(
    async (id: string, categoryId: string | null): Promise<void> => {
      const row = reviewItems.find((t) => t.id === id);
      if (!row || row.categoryId === categoryId) return;
      setFailedIds(null);
      const revert = revertTo(reviewItems, reviewCount, [id]);
      const picked = categoryId ? categories.find((c) => c.id === categoryId) : null;
      setReviewItems((xs) =>
        xs.map((t) =>
          t.id === id
            ? {
                ...t,
                categoryId,
                categoryName: picked?.name ?? null,
                categoryColor: picked?.color ?? null,
              }
            : t,
        ),
      );
      try {
        const res = await portalFetch(`/api/portal/transactions/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });
        if (!res.ok) revert();
      } catch {
        revert();
      }
    },
    [reviewItems, reviewCount, categories, portalFetch, revertTo],
  );

  return (
    <>
      {/*
        Two independent columns (not a synchronized grid) so a short tile like
        Monthly spending doesn't leave dead space beside the tall Net worth
        chart — the next tile in its column rises to fill it. Left column is
        the plan, right column is every budgeting tile. Stacks to one column
        below `lg`, which puts Net worth and Goals funded at the top of the
        phone view, ahead of the month-to-month money tiles.
      */}
      <div
        className="flex flex-col gap-5 lg:flex-row lg:items-start"
        data-testid="dashboard-grid"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <TileNetWorth netWorth={dto.netWorth} onOpen={() => setDetail({ kind: "networth" })} />
          <TileGoalsFunded goals={dto.goals} projected={dto.goalsProjected} />
        </div>
        {/* Whole column, not just its tiles — an empty flex-1 sibling would
            leave the left column stranded at half width on desktop. */}
        {budgetEnabled && (
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {sharing.shareBudgets ? (
              <TileMonthlySpending
                spending={dto.spending}
                onOpen={() => setDetail({ kind: "spending" })}
              />
            ) : (
              <NotSharedNotice area="budgets" variant="tile" />
            )}
            {showToReview ? (
              <TileToReview
                items={reviewItems}
                count={reviewCount}
                error={failedIds !== null}
                editEnabled={editEnabled}
                categories={categories}
                onMarkReviewed={(id) => void markReviewed(id)}
                onMarkPage={() => void markPageReviewed()}
                onPickCategory={(id, categoryId) => void pickCategory(id, categoryId)}
                onOpen={(id) => setDetail({ kind: "transaction", id })}
              />
            ) : (
              <NotSharedNotice area="transactions" variant="tile" />
            )}
            {sharing.shareTransactions ? (
              <TileNetThisMonth netThisMonth={dto.netThisMonth} />
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
            {sharing.shareRecurrings ? (
              <TileNextTwoWeeks
                recurrings={dto.recurrings}
                onOpen={(id) => setDetail({ kind: "recurring", id })}
              />
            ) : (
              <NotSharedNotice area="recurrings" variant="tile" />
            )}
          </div>
        )}
      </div>
      {detail && (
        <PortalDetailPortal closeLabel="Close details" onClose={closeDetail}>
          <DashboardDetailPanel
            payload={detail}
            dto={dto}
            reviewItems={reviewItems}
            editEnabled={editEnabled}
            categories={categories}
            failedIds={failedIds}
            onOpenCategory={(categoryId, name) =>
              setDetail({ kind: "category", categoryId, name })
            }
            onMarkReviewed={(id) => void markReviewed(id)}
            onPickCategory={(id, categoryId) => void pickCategory(id, categoryId)}
            onClose={closeDetail}
          />
        </PortalDetailPortal>
      )}
    </>
  );
}
