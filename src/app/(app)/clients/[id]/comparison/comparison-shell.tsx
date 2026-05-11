"use client";

import { useState } from "react";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { ComparisonKpiStrip } from "./comparison-kpi-strip";
import { PortfolioComparisonSection } from "@/components/comparison/portfolio-comparison-section";
import { LifetimeTaxComparisonSection } from "@/components/comparison/lifetime-tax-comparison-section";
import { EstateTaxComparisonSection } from "@/components/comparison/estate-tax-comparison-section";
import { MonteCarloAndLongevity } from "./monte-carlo-and-longevity";

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
}

export function ComparisonShell({ clientId, plans }: Props) {
  const [mcSuccessByIndex, setMcSuccessByIndex] = useState<Record<number, number>>({});

  const isLive = plans.length >= 2 && plans.some((p, i) => i > 0 && p.id !== plans[0].id);

  return (
    <>
      <ComparisonKpiStrip plans={plans} mcSuccessByIndex={mcSuccessByIndex} />
      {!isLive ? (
        <div className="px-6 py-16 text-center text-slate-400">
          Pick a second plan to see the comparison.
        </div>
      ) : (
        <>
          <PortfolioComparisonSection plans={plans} />
          <MonteCarloAndLongevity
            clientId={clientId}
            plans={plans}
            onMcSuccess={(idx, rate) =>
              setMcSuccessByIndex((prev) => ({ ...prev, [idx]: rate }))
            }
          />
          <LifetimeTaxComparisonSection plans={plans} />
          <EstateTaxComparisonSection clientId={clientId} plans={plans} />
        </>
      )}
    </>
  );
}
