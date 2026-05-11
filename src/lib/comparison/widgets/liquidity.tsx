import { LiquidityComparisonCharts } from "@/components/comparison/liquidity-comparison-charts";
import type { ComparisonWidgetDefinition } from "./types";

export const liquidityWidget: ComparisonWidgetDefinition = {
  kind: "liquidity",
  title: "Liquidity",
  needsMc: false,
  render: ({ plans, collapsed }) =>
    collapsed ? null : (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Liquidity</h2>
        <LiquidityComparisonCharts plans={plans} />
      </section>
    ),
};
