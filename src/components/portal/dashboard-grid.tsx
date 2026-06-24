"use client";
import { useState, type ReactElement } from "react";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileMonthlySpending } from "./dashboard-tiles/tile-monthly-spending";
import { TileNetWorth } from "./dashboard-tiles/tile-net-worth";
import { TileNetThisMonth } from "./dashboard-tiles/tile-net-this-month";

export type DrawerPayload =
  | { kind: "category"; categoryId: string; name: string }
  | { kind: "recurring"; id: string }
  | { kind: "transaction"; id: string };

export function DashboardGrid({ dto }: { dto: PortalDashboardDTO }): ReactElement {
  const [, setDrawer] = useState<DrawerPayload | null>(null);
  void setDrawer; // wired in Task 6
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-testid="dashboard-grid">
      <TileMonthlySpending spending={dto.spending} />
      <TileNetWorth netWorth={dto.netWorth} />
      <TileNetThisMonth netThisMonth={dto.netThisMonth} />
    </div>
  );
}
