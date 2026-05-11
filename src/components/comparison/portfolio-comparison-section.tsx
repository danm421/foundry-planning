import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { PortfolioOverlayChart } from "@/components/cashflow/charts/portfolio-overlay-chart";

interface Props { plans: ComparisonPlan[]; }

export function PortfolioComparisonSection({ plans }: Props) {
  const plan1 = plans[0];
  const plan2 = plans[1] ?? plans[0];
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Portfolio Assets</h2>
      <PortfolioOverlayChart
        plan1Years={plan1.result.years}
        plan2Years={plan2.result.years}
        plan1Label={plan1.label}
        plan2Label={plan2.label}
      />
    </section>
  );
}
