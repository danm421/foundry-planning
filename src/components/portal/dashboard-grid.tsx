"use client";
import { useState, type ReactElement } from "react";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";

/** Drawer payloads opened from itemized tiles (Task 6 fills the bodies). */
export type DrawerPayload =
  | { kind: "category"; categoryId: string; name: string }
  | { kind: "recurring"; id: string }
  | { kind: "transaction"; id: string };

export function DashboardGrid({ dto }: { dto: PortalDashboardDTO }): ReactElement {
  // `dto` and `setDrawer` wire up in Tasks 5–6; referenced now to satisfy lint.
  const [, setDrawer] = useState<DrawerPayload | null>(null);
  void dto;
  void setDrawer;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-testid="dashboard-grid" />
  );
}
