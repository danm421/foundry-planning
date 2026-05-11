import { PortfolioOverlayChart } from "@/components/cashflow/charts/portfolio-overlay-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

interface Props {
  plans: ComparisonPlan[];
}

export function PortfolioComparisonSection({ plans }: Props) {
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Portfolio Assets</h2>
      <PortfolioOverlayChart
        plans={plans.map((p) => ({ label: p.label, years: p.result.years }))}
      />
    </section>
  );
}
