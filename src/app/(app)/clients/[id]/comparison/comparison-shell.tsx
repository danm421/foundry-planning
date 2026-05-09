"use client";

import { useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type { LifetimeTaxSummary } from "@/lib/comparison/lifetime-tax";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";
import { ComparisonKpiStrip } from "./comparison-kpi-strip";
import { PortfolioComparisonSection } from "@/components/comparison/portfolio-comparison-section";
import { LifetimeTaxComparisonSection } from "@/components/comparison/lifetime-tax-comparison-section";
import { EstateTaxComparisonSection } from "@/components/comparison/estate-tax-comparison-section";
import { MonteCarloAndLongevity } from "./monte-carlo-and-longevity";

interface Props {
  clientId: string;
  plan1Id: string;
  plan2Id: string;
  plan1Label: string;
  plan2Label: string;
  plan1Tree: ClientData;
  plan2Tree: ClientData;
  plan1Result: ProjectionResult;
  plan2Result: ProjectionResult;
  plan1Lifetime: LifetimeTaxSummary;
  plan2Lifetime: LifetimeTaxSummary;
  endingNetWorthDelta: number;
  lifetimeTaxDelta: number;
  toHeirsDelta: number;
  estateTaxDelta: number;
  yearsSurvivesDelta: number;
  plan2Provided: boolean;
  liquidity1Rows: YearlyLiquidityReport["rows"];
  liquidity2Rows: YearlyLiquidityReport["rows"];
  finalEstate1: YearlyEstateRow | null;
  finalEstate2: YearlyEstateRow | null;
}

export function ComparisonShell(p: Props) {
  const [mcSuccessDelta, setMcSuccessDelta] = useState<number | undefined>(undefined);

  return (
    <>
      <ComparisonKpiStrip
        endingNetWorthDelta={p.endingNetWorthDelta}
        mcSuccessDelta={p.plan2Provided ? mcSuccessDelta : 0}
        lifetimeTaxDelta={p.lifetimeTaxDelta}
        toHeirsDelta={p.toHeirsDelta}
        estateTaxDelta={p.estateTaxDelta}
        yearsSurvivesDelta={p.yearsSurvivesDelta}
      />
      {!p.plan2Provided ? (
        <div className="px-6 py-16 text-center text-slate-400">
          Pick a second plan to see the comparison.
        </div>
      ) : (
        <>
          <PortfolioComparisonSection
            plan1Years={p.plan1Result.years}
            plan2Years={p.plan2Result.years}
            plan1Label={p.plan1Label}
            plan2Label={p.plan2Label}
          />
          <MonteCarloAndLongevity
            clientId={p.clientId}
            plan1Tree={p.plan1Tree}
            plan2Tree={p.plan2Tree}
            plan1Label={p.plan1Label}
            plan2Label={p.plan2Label}
            plan1Years={p.plan1Result.years.map((y) => ({ year: y.year }))}
            onMcSuccessDelta={setMcSuccessDelta}
          />
          <LifetimeTaxComparisonSection
            plan1={p.plan1Lifetime}
            plan2={p.plan2Lifetime}
            plan1Label={p.plan1Label}
            plan2Label={p.plan2Label}
          />
          <EstateTaxComparisonSection
            clientId={p.clientId}
            plan1Result={p.plan1Result}
            plan2Result={p.plan2Result}
            plan1Id={p.plan1Id}
            plan2Id={p.plan2Id}
            plan1Label={p.plan1Label}
            plan2Label={p.plan2Label}
            liquidity1Rows={p.liquidity1Rows}
            liquidity2Rows={p.liquidity2Rows}
            finalEstate1={p.finalEstate1}
            finalEstate2={p.finalEstate2}
          />
        </>
      )}
    </>
  );
}
