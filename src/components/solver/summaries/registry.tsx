// src/components/solver/summaries/registry.tsx
import type { ComponentType } from "react";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { SummaryKey } from "./types";

import { buildRetirementSummaryData } from "@/lib/presentations/pages/retirement-summary/view-model";
import { buildRetirementComparisonData } from "@/lib/presentations/pages/retirement-comparison/view-model";
import { buildTaxSummaryData } from "@/lib/presentations/pages/tax-summary/view-model";
import { buildTaxComparisonData } from "@/lib/presentations/pages/tax-comparison/view-model";
import { buildMedicareSummaryData } from "@/lib/presentations/pages/medicare-summary/view-model";
import { buildEstateSummaryData } from "@/lib/presentations/pages/estate-summary/view-model";
import { buildLifeInsuranceSummaryData } from "@/lib/presentations/pages/life-insurance-summary/view-model";

import { RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-summary/options-schema";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-comparison/options-schema";
import { TAX_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/tax-summary/options-schema";
import { TAX_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/tax-comparison/options-schema";
import { MEDICARE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/medicare-summary/options-schema";
import { ESTATE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/estate-summary/options-schema";
import { LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import { WORKING_SCENARIO_ID } from "@/lib/solver/comparison-bundles";

import { RetirementSummaryView } from "./retirement-summary-view";
import { RetirementComparisonView } from "./retirement-comparison-view";
import { TaxSummaryView } from "./tax-summary-view";
import { TaxComparisonView } from "./tax-comparison-view";
import { MedicareSummaryView } from "./medicare-summary-view";
import { EstateSummaryView } from "./estate-summary-view";
import { LifeInsuranceSummaryView } from "./life-insurance-summary-view";

export interface SummaryDef {
  label: string;
  build: (ctx: BuildDataContext) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<{ data: any }>;
  needs: { fullProjection?: boolean; liInventory?: boolean };
}

export const SUMMARY_REGISTRY: Record<SummaryKey, SummaryDef> = {
  retirement: {
    label: "Retirement",
    build: (ctx) => buildRetirementSummaryData(ctx, RETIREMENT_SUMMARY_OPTIONS_DEFAULT),
    Component: RetirementSummaryView,
    needs: {},
  },
  retirementComparison: {
    label: "Retirement Comparison",
    // Rendered via SolverRetirementComparisonPanel (Run button + server route);
    // this build/Component pair is never used for data — see SolverSummaryPanel.
    build: (ctx) => buildRetirementComparisonData(ctx, { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT, scenarioId: WORKING_SCENARIO_ID, showAiSummary: false }),
    Component: RetirementComparisonView,
    needs: {},
  },
  tax: {
    label: "Tax",
    build: (ctx) => buildTaxSummaryData(ctx, TAX_SUMMARY_OPTIONS_DEFAULT),
    Component: TaxSummaryView,
    needs: {},
  },
  taxComparison: {
    label: "Tax Comparison",
    build: (ctx) => buildTaxComparisonData(ctx, { ...TAX_COMPARISON_OPTIONS_DEFAULT, scenarioId: WORKING_SCENARIO_ID }),
    Component: TaxComparisonView,
    needs: {},
  },
  medicare: {
    label: "Medicare",
    build: (ctx) => buildMedicareSummaryData(ctx, MEDICARE_SUMMARY_OPTIONS_DEFAULT),
    Component: MedicareSummaryView,
    needs: {},
  },
  estate: {
    label: "Estate",
    build: (ctx) => buildEstateSummaryData(ctx, ESTATE_SUMMARY_OPTIONS_DEFAULT),
    Component: EstateSummaryView,
    needs: { fullProjection: true },
  },
  lifeInsurance: {
    label: "Life Insurance",
    build: (ctx) => buildLifeInsuranceSummaryData(ctx, LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT),
    Component: LifeInsuranceSummaryView,
    needs: { liInventory: true },
  },
};

const SUMMARY_TAB_ORDER: SummaryKey[] = ["retirement", "retirementComparison", "tax", "taxComparison", "medicare", "estate", "lifeInsurance"];
export const SUMMARY_TABS = SUMMARY_TAB_ORDER.map((key) => ({ key, label: SUMMARY_REGISTRY[key].label }));
