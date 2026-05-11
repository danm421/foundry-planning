import { MonteCarloComparisonSection } from "@/components/comparison/monte-carlo-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const monteCarloWidget: ComparisonWidgetDefinition = {
  kind: "monte-carlo",
  title: "Monte Carlo",
  category: "monte-carlo",
  scenarios: "one-or-many",
  needsMc: true,
  render: ({ mc }) => {
    if (!mc) {
      return (
        <section className="px-6 py-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Monte Carlo</h2>
          <div className="h-72 animate-pulse rounded border border-slate-800 bg-slate-900" />
        </section>
      );
    }
    return <MonteCarloComparisonSection plansMc={mc.perPlan} />;
  },
};
