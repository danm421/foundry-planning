import { PortfolioOverlayChart } from "@/components/cashflow/charts/portfolio-overlay-chart";
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
    </section>
  );
}
