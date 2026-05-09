import { PortfolioOverlayChart } from "@/components/cashflow/charts/portfolio-overlay-chart";
import { PortfolioChart } from "@/components/cashflow/charts/portfolio-chart";
import type { ProjectionYear } from "@/engine/types";

interface Props {
  plan1Years: ProjectionYear[];
  plan2Years: ProjectionYear[];
  plan1Label: string;
  plan2Label: string;
}

export function PortfolioComparisonSection({
  plan1Years,
  plan2Years,
  plan1Label,
  plan2Label,
}: Props) {
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Portfolio Assets</h2>
      <PortfolioOverlayChart
        plan1Years={plan1Years}
        plan2Years={plan2Years}
        plan1Label={plan1Label}
        plan2Label={plan2Label}
      />
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">{plan1Label}</div>
          <PortfolioChart years={plan1Years} />
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">{plan2Label}</div>
          <PortfolioChart years={plan2Years} />
        </div>
      </div>
    </section>
  );
}
