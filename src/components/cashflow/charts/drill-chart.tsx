"use client";

import type { ProjectionYear, ClientData } from "@/engine";
import { IncomeChart } from "./income-chart";

interface DrillChartProps {
  drillPath: string[];
  years: ProjectionYear[];
  clientData: ClientData | null;
  accountNames: Record<string, string>;
  accountSubTypes: Record<string, string>;
}

export function DrillChart({ drillPath, years }: DrillChartProps) {
  const level = drillPath[0];
  if (level === "income") return <IncomeChart years={years} />;
  return null;
}
