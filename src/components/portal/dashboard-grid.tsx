"use client";
import { useState, type ReactElement } from "react";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileMonthlySpending } from "./dashboard-tiles/tile-monthly-spending";
import { TileNetWorth } from "./dashboard-tiles/tile-net-worth";
import { TileNetThisMonth } from "./dashboard-tiles/tile-net-this-month";
import { TileToReview } from "./dashboard-tiles/tile-to-review";
import { TileTopCategories } from "./dashboard-tiles/tile-top-categories";
import { TileNextTwoWeeks } from "./dashboard-tiles/tile-next-two-weeks";
import { PortalDetailDrawer } from "./portal-detail-drawer";

export type DrawerPayload =
  | { kind: "category"; categoryId: string; name: string }
  | { kind: "recurring"; id: string }
  | { kind: "transaction"; id: string };

export function DashboardGrid({ dto }: { dto: PortalDashboardDTO }): ReactElement {
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-testid="dashboard-grid">
        <TileMonthlySpending spending={dto.spending} />
        <TileNetWorth netWorth={dto.netWorth} />
        <TileToReview
          toReview={dto.toReview}
          onOpen={(id) => setDrawer({ kind: "transaction", id })}
        />
        <TileTopCategories
          topCategories={dto.topCategories}
          onOpen={(categoryId, name) => setDrawer({ kind: "category", categoryId, name })}
        />
        <TileNetThisMonth netThisMonth={dto.netThisMonth} />
        <TileNextTwoWeeks
          recurrings={dto.recurrings}
          onOpen={(id) => setDrawer({ kind: "recurring", id })}
        />
      </div>
      {drawer && (
        <PortalDetailDrawer
          payload={drawer}
          recurrings={dto.recurrings}
          toReview={dto.toReview}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}
