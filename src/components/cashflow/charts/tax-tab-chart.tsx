"use client";

import type { ProjectionYear } from "@/engine";
import type { TaxDetailTabId } from "@/components/cashflow/tax-detail-view";
import { TaxIncomeChart } from "./tax-income-chart";
import { TaxFederalChart } from "./tax-federal-chart";
import { TaxBracketChart } from "./tax-bracket-chart";

interface TaxTabChartProps {
  activeTab: TaxDetailTabId;
  years: ProjectionYear[];
}

export function TaxTabChart({ activeTab, years }: TaxTabChartProps) {
  if (activeTab === "income") return <TaxIncomeChart years={years} />;
  if (activeTab === "federal") return <TaxFederalChart years={years} />;
  if (activeTab === "bracket") return <TaxBracketChart years={years} />;
  return null;
}
