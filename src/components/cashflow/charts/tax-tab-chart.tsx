"use client";

import type { ProjectionYear } from "@/engine";
import type { TaxDetailTabId } from "@/components/cashflow/tax-detail-view";
import { TaxIncomeChart } from "./tax-income-chart";
import { TaxFederalChart } from "./tax-federal-chart";

interface TaxTabChartProps {
  activeTab: TaxDetailTabId;
  years: ProjectionYear[];
}

export function TaxTabChart({ activeTab, years }: TaxTabChartProps) {
  if (activeTab === "income") return <TaxIncomeChart years={years} />;
  if (activeTab === "federal") return <TaxFederalChart years={years} />;
  // "bracket" tab gets its custom chart in Phase 3.
  return null;
}
