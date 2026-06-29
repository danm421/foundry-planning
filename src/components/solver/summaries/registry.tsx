// src/components/solver/summaries/registry.tsx
import type { ComponentType } from "react";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { SummaryKey } from "./types";

import { buildRetirementSummaryData } from "@/lib/presentations/pages/retirement-summary/view-model";
import { buildTaxSummaryData } from "@/lib/presentations/pages/tax-summary/view-model";
import { buildMedicareSummaryData } from "@/lib/presentations/pages/medicare-summary/view-model";
import { buildEstateSummaryData } from "@/lib/presentations/pages/estate-summary/view-model";
import { buildLifeInsuranceSummaryData } from "@/lib/presentations/pages/life-insurance-summary/view-model";

import { RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-summary/options-schema";
import { TAX_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/tax-summary/options-schema";
import { MEDICARE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/medicare-summary/options-schema";
import { ESTATE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/estate-summary/options-schema";
import { LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/life-insurance-summary/options-schema";

import { RetirementSummaryView } from "./retirement-summary-view";
import { TaxSummaryView } from "./tax-summary-view";
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
  tax: {
    label: "Tax",
    build: (ctx) => buildTaxSummaryData(ctx, TAX_SUMMARY_OPTIONS_DEFAULT),
    Component: TaxSummaryView,
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

const SUMMARY_TAB_ORDER: SummaryKey[] = ["retirement", "tax", "medicare", "estate", "lifeInsurance"];
export const SUMMARY_TABS = SUMMARY_TAB_ORDER.map((key) => ({ key, label: SUMMARY_REGISTRY[key].label }));
