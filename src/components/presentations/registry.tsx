import type { z } from "zod";
import type { ComponentType, ReactElement } from "react";
import type {
  CashFlowPageData,
  CashFlowPageOptions,
  BuildCashFlowInput,
  CoverPageData,
  CoverPageOptions,
  TocPageData,
  TocPageOptions,
} from "@/lib/presentations/types";
import {
  CASH_FLOW_PAGE_OPTIONS_DEFAULT,
  COVER_PAGE_OPTIONS_DEFAULT,
  TOC_PAGE_OPTIONS_DEFAULT,
} from "@/lib/presentations/types";
import { buildCashFlowPageData } from "@/lib/presentations/pages/cash-flow/view-model";
import { cashFlowOptionsSchema } from "@/lib/presentations/pages/cash-flow/options-schema";
import { summarizeCashFlowOptions } from "@/lib/presentations/pages/cash-flow/summarize-options";
import { estimateCashFlowPageCount } from "@/lib/presentations/pages/cash-flow/estimate-page-count";
import { coverOptionsSchema } from "@/lib/presentations/pages/cover/options-schema";
import { summarizeCoverOptions } from "@/lib/presentations/pages/cover/summarize-options";
import { estimateCoverPageCount } from "@/lib/presentations/pages/cover/estimate-page-count";
import { tocOptionsSchema } from "@/lib/presentations/pages/toc/options-schema";
import { summarizeTocOptions } from "@/lib/presentations/pages/toc/summarize-options";
import { estimateTocPageCount } from "@/lib/presentations/pages/toc/estimate-page-count";
import { CashFlowOptionsControl } from "./pages/cash-flow/options-control";
import { CashflowPagePdf } from "./pages/cash-flow/page-pdf";
import { CoverOptionsControl } from "./pages/cover/options-control";
import { CoverPdf } from "./pages/cover/page-pdf";
import { TocPdf, type TocSection } from "./pages/toc/page-pdf";
// Shared drill-down infrastructure used by every Cash Flow > * drill page.
import { DrillPagePdf } from "./shared/drill-page-pdf";
import { DrillOptionsControl } from "./shared/drill-options-control";
import {
  DRILL_PAGE_OPTIONS_DEFAULT,
  drillOptionsSchema,
  summarizeDrillOptions,
  estimateDrillPageCount,
} from "@/lib/presentations/shared/drill-options";
import type {
  DrillPageData,
  DrillPageOptions,
} from "@/lib/presentations/shared/drill-types";
import { buildIncomeDrillData } from "@/lib/presentations/pages/cash-flow-income/view-model";
import { buildExpensesDrillData } from "@/lib/presentations/pages/cash-flow-expenses/view-model";
import { buildSavingsDrillData } from "@/lib/presentations/pages/cash-flow-savings/view-model";
import { buildNetCashFlowDrillData } from "@/lib/presentations/pages/cash-flow-net/view-model";
import { buildPortfolioGrowthDrillData } from "@/lib/presentations/pages/cash-flow-growth/view-model";
import { buildPortfolioActivityDrillData } from "@/lib/presentations/pages/cash-flow-activity/view-model";
import { buildPortfolioAssetsDrillData } from "@/lib/presentations/pages/cash-flow-assets/view-model";
import type { ProjectionYear, ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { buildEstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import type { EstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import {
  estateOptionsSchema,
  ESTATE_PAGE_OPTIONS_DEFAULT,
  type EstatePageOptions,
} from "@/lib/presentations/pages/estate-shared/options-schema";
import { summarizeEstateOptions } from "@/lib/presentations/pages/estate-shared/summarize-options";
import {
  estimateEstateChartPageCount,
  estimateEstateReportPageCount,
} from "@/lib/presentations/pages/estate-shared/estimate-page-count";
import { EstateOptionsControl } from "./pages/estate-shared/options-control";
import { EstateFlowChartPagePdf } from "./pages/estate-flow-chart/page-pdf";
import { buildEstateFlowReportData } from "@/lib/presentations/pages/estate-flow/view-model";
import type { EstateFlowReportData } from "@/lib/presentations/pages/estate-flow/view-model";
import { EstateFlowReportPagePdf } from "./pages/estate-flow/page-pdf";

export const CATEGORY_ORDER = [
  "Framing",
  "Cash Flow",
  "Balance Sheet",
  "Estate",
  "Monte Carlo",
  "Insurance",
  "Tax",
  "Net Worth",
] as const;

export type PresentationCategory = (typeof CATEGORY_ORDER)[number];

export interface BuildDataContext {
  years: ProjectionYear[];
  /** Full projection — superset of `years`. Estate pages consume the death
   *  events and ledgers that `years` alone doesn't expose. */
  projection: ProjectionResult;
  clientData: ClientData;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
  firmName: string;
  firmTagline: string | null;
  reportDate: string;
}

export interface RenderPdfInput<TData> {
  data: TData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  // Only populated for pages that need cross-page layout (TOC). Other pages
  // ignore this field.
  documentSections?: TocSection[];
}

export interface PresentationPage<TData, TOptions> {
  id: string;
  title: string;
  description: string;
  category: PresentationCategory;
  defaultOptions: TOptions;
  optionsSchema: z.ZodType<TOptions>;
  summarizeOptions: (options: TOptions) => string;
  estimatePageCount: (data: TData, options: TOptions) => number;
  // Optional: pages without per-instance configuration (e.g., TOC) omit this.
  OptionsControl?: ComponentType<{ value: TOptions; onChange: (next: TOptions) => void }>;
  // False for framing pages (Cover, TOC) that don't render scenario-specific data.
  supportsScenarioOverride: boolean;
  buildData: (ctx: BuildDataContext, options: TOptions) => TData;
  renderPdf: (input: RenderPdfInput<TData>) => ReactElement;
}

export const cashFlowPage: PresentationPage<CashFlowPageData, CashFlowPageOptions> = {
  id: "cashFlow",
  title: "Cash Flow",
  description: "Annual income, expenses, withdrawals, and portfolio totals.",
  category: "Cash Flow",
  defaultOptions: CASH_FLOW_PAGE_OPTIONS_DEFAULT,
  optionsSchema: cashFlowOptionsSchema,
  summarizeOptions: summarizeCashFlowOptions,
  estimatePageCount: estimateCashFlowPageCount,
  OptionsControl: CashFlowOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) =>
    buildCashFlowPageData({
      years: ctx.years,
      clientData: ctx.clientData,
      options,
      scenarioLabel: ctx.scenarioLabel,
      clientName: ctx.clientName,
      spouseName: ctx.spouseName,
    } as BuildCashFlowInput),
  renderPdf: (input) => <CashflowPagePdf {...input} />,
};

export const coverPage: PresentationPage<CoverPageData, CoverPageOptions> = {
  id: "cover",
  title: "Cover Sheet",
  description: "Title page with firm, client, scenario, and date.",
  category: "Framing",
  defaultOptions: COVER_PAGE_OPTIONS_DEFAULT,
  optionsSchema: coverOptionsSchema,
  summarizeOptions: summarizeCoverOptions,
  estimatePageCount: estimateCoverPageCount,
  OptionsControl: CoverOptionsControl,
  supportsScenarioOverride: false,
  buildData: (ctx, options) => ({
    title: options.title,
    firmName: ctx.firmName,
    firmTagline: ctx.firmTagline,
    clientName: ctx.clientName,
    spouseName: ctx.spouseName,
    scenarioLabel: ctx.scenarioLabel,
    reportDate: ctx.reportDate,
  }),
  renderPdf: ({ data }) => (
    <CoverPdf
      title={data.title}
      firmName={data.firmName}
      firmTagline={data.firmTagline}
      clientName={data.clientName}
      spouseName={data.spouseName}
      scenarioLabel={data.scenarioLabel}
      reportDate={data.reportDate}
    />
  ),
};

export const tocPage: PresentationPage<TocPageData, TocPageOptions> = {
  id: "toc",
  title: "Table of Contents",
  description: "Auto-generated contents page listing the document's sections.",
  category: "Framing",
  defaultOptions: TOC_PAGE_OPTIONS_DEFAULT,
  optionsSchema: tocOptionsSchema,
  summarizeOptions: summarizeTocOptions,
  estimatePageCount: estimateTocPageCount,
  supportsScenarioOverride: false,
  buildData: () => ({}),
  renderPdf: ({ documentSections }) => (
    <TocPdf sections={documentSections ?? []} />
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Cash Flow drill-down pages — every one is a thin wrapper: drill-specific
// view-model + shared options/control/page-pdf. Column defs + chart stacks
// mirror the matching Level-1 drill in cashflow-report.tsx.
// ─────────────────────────────────────────────────────────────────────────────

function makeDrillPage(
  id: string,
  title: string,
  description: string,
  build: (input: {
    years: ProjectionYear[];
    clientData: ClientData;
    options: DrillPageOptions;
    scenarioLabel: string;
    clientName: string;
    spouseName: string | null;
  }) => DrillPageData,
): PresentationPage<DrillPageData, DrillPageOptions> {
  return {
    id,
    title,
    description,
    category: "Cash Flow",
    defaultOptions: DRILL_PAGE_OPTIONS_DEFAULT,
    optionsSchema: drillOptionsSchema,
    summarizeOptions: summarizeDrillOptions,
    estimatePageCount: estimateDrillPageCount,
    OptionsControl: DrillOptionsControl,
    supportsScenarioOverride: true,
    buildData: (ctx, options) =>
      build({
        years: ctx.years,
        clientData: ctx.clientData,
        options,
        scenarioLabel: ctx.scenarioLabel,
        clientName: ctx.clientName,
        spouseName: ctx.spouseName,
      }),
    renderPdf: (input) => <DrillPagePdf {...input} />,
  };
}

export const cashFlowIncomePage = makeDrillPage(
  "cashFlowIncome",
  "Cash Flow — Income",
  "Annual breakdown of income sources (salaries, Social Security, business, trust, deferred, capital gains, other).",
  buildIncomeDrillData,
);

export const cashFlowExpensesPage = makeDrillPage(
  "cashFlowExpenses",
  "Cash Flow — Expenses",
  "Annual breakdown of expenses by category (living, surplus, liabilities, insurance, real estate, taxes, other).",
  buildExpensesDrillData,
);

export const cashFlowSavingsPage = makeDrillPage(
  "cashFlowSavings",
  "Cash Flow — Savings",
  "Annual savings contributions, per-account.",
  buildSavingsDrillData,
);

export const cashFlowNetPage = makeDrillPage(
  "cashFlowNet",
  "Cash Flow — Net Cash Flow",
  "Supplemental withdrawals by asset category with beginning-of-year portfolio and withdrawal rate.",
  buildNetCashFlowDrillData,
);

export const cashFlowGrowthPage = makeDrillPage(
  "cashFlowGrowth",
  "Cash Flow — Portfolio Growth",
  "Portfolio investment growth by asset category.",
  buildPortfolioGrowthDrillData,
);

export const cashFlowActivityPage = makeDrillPage(
  "cashFlowActivity",
  "Cash Flow — Portfolio Activity",
  "External contributions to and distributions from the portfolio.",
  buildPortfolioActivityDrillData,
);

export const cashFlowAssetsPage = makeDrillPage(
  "cashFlowAssets",
  "Cash Flow — Portfolio Assets",
  "Year-end portfolio asset values by category, with liquid and grand totals.",
  buildPortfolioAssetsDrillData,
);

export const estateFlowChartPage: PresentationPage<EstateFlowChartData, EstatePageOptions> = {
  id: "estateFlowChart",
  title: "Estate Flow — Chart",
  description: "Visual estate flow: estate value through each death to heirs, taxes, and trusts.",
  category: "Estate",
  defaultOptions: ESTATE_PAGE_OPTIONS_DEFAULT,
  optionsSchema: estateOptionsSchema,
  summarizeOptions: summarizeEstateOptions,
  estimatePageCount: estimateEstateChartPageCount,
  OptionsControl: EstateOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildEstateFlowChartData(ctx, options),
  renderPdf: (input) => <EstateFlowChartPagePdf {...input} />,
};

export const estateFlowReportPage: PresentationPage<EstateFlowReportData, EstatePageOptions> = {
  id: "estateFlow",
  title: "Estate Flow — Report",
  description: "Ownership today, transfers at first death, and final distribution at second death.",
  category: "Estate",
  defaultOptions: ESTATE_PAGE_OPTIONS_DEFAULT,
  optionsSchema: estateOptionsSchema,
  summarizeOptions: summarizeEstateOptions,
  estimatePageCount: estimateEstateReportPageCount,
  OptionsControl: EstateOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildEstateFlowReportData(ctx, options),
  renderPdf: (input) => <EstateFlowReportPagePdf {...input} />,
};

export const PRESENTATION_PAGES = {
  cover: coverPage,
  toc: tocPage,
  cashFlow: cashFlowPage,
  cashFlowIncome: cashFlowIncomePage,
  cashFlowExpenses: cashFlowExpensesPage,
  cashFlowSavings: cashFlowSavingsPage,
  cashFlowNet: cashFlowNetPage,
  cashFlowGrowth: cashFlowGrowthPage,
  cashFlowActivity: cashFlowActivityPage,
  cashFlowAssets: cashFlowAssetsPage,
  estateFlowChart: estateFlowChartPage,
  estateFlow: estateFlowReportPage,
} as const;

export type PresentationPageId = keyof typeof PRESENTATION_PAGES;
