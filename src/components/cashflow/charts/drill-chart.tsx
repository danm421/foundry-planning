"use client";

import type { ProjectionYear, ClientData } from "@/engine";
import { IncomeChart } from "./income-chart";
import { ExpensesChart } from "./expenses-chart";
import { SavingsChart } from "./savings-chart";
import { WithdrawalsChart } from "./withdrawals-chart";
import { PortfolioChart } from "./portfolio-chart";

interface DrillChartProps {
  drillPath: string[];
  years: ProjectionYear[];
  clientData: ClientData | null;
  accountNames: Record<string, string>;
  accountSubTypes: Record<string, string>;
  accountCategoryById: Record<string, string>;
}

export function DrillChart({ drillPath, years, accountSubTypes, accountCategoryById }: DrillChartProps) {
  const level = drillPath[0];
  if (level === "income") return <IncomeChart years={years} />;
  if (level === "expenses") return <ExpensesChart years={years} />;
  if (level === "savings") return <SavingsChart years={years} accountSubTypes={accountSubTypes} />;
  if (level === "cashflow") return <WithdrawalsChart years={years} accountCategoryById={accountCategoryById} />;
  if (level === "portfolio") return <PortfolioChart years={years} />;
  return null;
}
