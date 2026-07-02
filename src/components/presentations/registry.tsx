import type { z } from "zod";
import type { ComponentType, ReactElement } from "react";
import type { SectionAccent } from "@/lib/presentations/theme";
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
import { estimateCashFlowPageCount } from "@/lib/presentations/pages/cash-flow/estimate-page-count";
import { coverOptionsSchema } from "@/lib/presentations/pages/cover/options-schema";
import { summarizeCoverOptions } from "@/lib/presentations/pages/cover/summarize-options";
import { estimateCoverPageCount } from "@/lib/presentations/pages/cover/estimate-page-count";
import { tocOptionsSchema } from "@/lib/presentations/pages/toc/options-schema";
import { summarizeTocOptions } from "@/lib/presentations/pages/toc/summarize-options";
import { estimateTocPageCount } from "@/lib/presentations/pages/toc/estimate-page-count";
import { CashFlowOptionsControl } from "./pages/cash-flow/options-control";
import { CashflowPagePdf } from "./pages/cash-flow/page-pdf";
import { buildEntityCashFlowPageData } from "./pages/entity-cash-flow/build-data";
import {
  entityCashFlowOptionsSchema,
  summarizeEntityCashFlowOptions,
  estimateEntityCashFlowPageCount,
} from "./pages/entity-cash-flow/options-schema";
import {
  ENTITY_CASH_FLOW_OPTIONS_DEFAULT,
  type EntityCashFlowPageOptions,
  type EntityCashFlowPageData,
} from "./pages/entity-cash-flow/types";
import { EntityCashFlowOptionsControl } from "./pages/entity-cash-flow/options-control";
import { EntityCashFlowPagePdf } from "./pages/entity-cash-flow/page-pdf";
import { CoverOptionsControl } from "./pages/cover/options-control";
import { CoverPdf } from "./pages/cover/page-pdf";
import { TocPdf, type TocSection } from "./pages/toc/page-pdf";
import { buildClientProfileData } from "@/lib/presentations/pages/client-profile/view-model";
import { clientProfileOptionsSchema } from "@/lib/presentations/pages/client-profile/options-schema";
import { summarizeClientProfileOptions } from "@/lib/presentations/pages/client-profile/summarize-options";
import { estimateClientProfilePageCount } from "@/lib/presentations/pages/client-profile/estimate-page-count";
import {
  CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT,
  type ClientProfilePageData,
  type ClientProfilePageOptions,
} from "@/lib/presentations/pages/client-profile/types";
import { ClientProfilePagePdf } from "./pages/client-profile/page-pdf";
import { buildAssumptionsData } from "@/lib/presentations/pages/assumptions/view-model";
import { estimateAssumptionsPageCount } from "@/lib/presentations/pages/assumptions/estimate-page-count";
import { summarizeAssumptionsOptions } from "@/lib/presentations/pages/assumptions/summarize-options";
import {
  assumptionsOptionsSchema,
  ASSUMPTIONS_OPTIONS_DEFAULT,
  type AssumptionsPageOptions,
} from "@/lib/presentations/pages/assumptions/options-schema";
import type { AssumptionsPageData } from "@/lib/presentations/pages/assumptions/types";
import { AssumptionsPagePdf } from "./pages/assumptions/page-pdf";
import { AssumptionsOptionsControl } from "./pages/assumptions/options-control";
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
import { buildTaxIncomeDrillData } from "@/lib/presentations/pages/income-tax-income/view-model";
import { buildTaxFederalDrillData } from "@/lib/presentations/pages/income-tax-federal/view-model";
import { buildTaxStateDrillData } from "@/lib/presentations/pages/income-tax-state/view-model";
import { buildTaxAboveLineDrillData } from "@/lib/presentations/pages/income-tax-above-line/view-model";
import { buildTaxBelowLineDrillData } from "@/lib/presentations/pages/income-tax-below-line/view-model";
import { buildTaxOtherTaxesDrillData } from "@/lib/presentations/pages/income-tax-other-taxes/view-model";
import { buildTaxBracketFederalDrillData } from "@/lib/presentations/pages/income-tax-bracket-federal/view-model";
import { buildTaxBracketStateDrillData } from "@/lib/presentations/pages/income-tax-bracket-state/view-model";
import { buildEstateTransferDrillData } from "@/lib/presentations/pages/estate-transfer/view-model";
import { buildEstateLiquidityDrillData } from "@/lib/presentations/pages/estate-liquidity/view-model";
import { buildGiftTaxDrillData } from "@/lib/presentations/pages/estate-gift-tax/view-model";
import type { EstateDrillInput } from "@/lib/presentations/pages/estate-shared";
import type { ProjectionYear, ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
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
import { buildEstateSummaryData } from "@/lib/presentations/pages/estate-summary/view-model";
import type { EstateSummaryPageData } from "@/lib/presentations/pages/estate-summary/view-model";
import {
  estateSummaryOptionsSchema,
  ESTATE_SUMMARY_OPTIONS_DEFAULT,
  type EstateSummaryOptions,
} from "@/lib/presentations/pages/estate-summary/options-schema";
import { summarizeEstateSummaryOptions } from "@/lib/presentations/pages/estate-summary/summarize-options";
import { estimateEstateSummaryPageCount } from "@/lib/presentations/pages/estate-summary/estimate-page-count";
import { EstateSummaryPagePdf } from "./pages/estate-summary/page-pdf";
import { buildTaxSummaryData } from "@/lib/presentations/pages/tax-summary/view-model";
import type { TaxSummaryPageData } from "@/lib/presentations/pages/tax-summary/view-model";
import {
  taxSummaryOptionsSchema,
  TAX_SUMMARY_OPTIONS_DEFAULT,
  type TaxSummaryOptions,
} from "@/lib/presentations/pages/tax-summary/options-schema";
import { summarizeTaxSummaryOptions } from "@/lib/presentations/pages/tax-summary/summarize-options";
import { estimateTaxSummaryPageCount } from "@/lib/presentations/pages/tax-summary/estimate-page-count";
import { TaxSummaryPagePdf } from "./pages/tax-summary/page-pdf";
import { buildTaxComparisonData } from "@/lib/presentations/pages/tax-comparison/view-model";
import type { TaxComparisonPageData } from "@/lib/presentations/pages/tax-comparison/view-model";
import {
  taxComparisonOptionsSchema,
  TAX_COMPARISON_OPTIONS_DEFAULT,
  type TaxComparisonOptions,
} from "@/lib/presentations/pages/tax-comparison/options-schema";
import { summarizeTaxComparisonOptions } from "@/lib/presentations/pages/tax-comparison/summarize-options";
import { estimateTaxComparisonPageCount } from "@/lib/presentations/pages/tax-comparison/estimate-page-count";
import { TaxComparisonPagePdf } from "./pages/tax-comparison/page-pdf";
import { buildMedicareSummaryData } from "@/lib/presentations/pages/medicare-summary/view-model";
import type { MedicareSummaryPageData } from "@/lib/presentations/pages/medicare-summary/view-model";
import {
  medicareSummaryOptionsSchema,
  MEDICARE_SUMMARY_OPTIONS_DEFAULT,
  type MedicareSummaryOptions,
} from "@/lib/presentations/pages/medicare-summary/options-schema";
import { summarizeMedicareSummaryOptions } from "@/lib/presentations/pages/medicare-summary/summarize-options";
import { estimateMedicareSummaryPageCount } from "@/lib/presentations/pages/medicare-summary/estimate-page-count";
import { MedicareSummaryPagePdf } from "./pages/medicare-summary/page-pdf";
import { buildRetirementSummaryData, type RetirementSummaryPageData } from "@/lib/presentations/pages/retirement-summary/view-model";
import { type RetirementSummaryOptions, retirementSummaryOptionsSchema, RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-summary/options-schema";
import { summarizeRetirementSummaryOptions } from "@/lib/presentations/pages/retirement-summary/summarize-options";
import { estimateRetirementSummaryPageCount } from "@/lib/presentations/pages/retirement-summary/estimate-page-count";
import { RetirementSummaryPagePdf } from "./pages/retirement-summary/page-pdf";
import { buildLifeInsuranceSummaryData } from "@/lib/presentations/pages/life-insurance-summary/view-model";
import type { LifeInsuranceSummaryPageData } from "@/lib/presentations/pages/life-insurance-summary/view-model";
import {
  lifeInsuranceSummaryOptionsSchema,
  LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT,
  type LifeInsuranceSummaryOptions,
} from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import { summarizeLifeInsuranceSummaryOptions } from "@/lib/presentations/pages/life-insurance-summary/summarize-options";
import { estimateLifeInsuranceSummaryPageCount } from "@/lib/presentations/pages/life-insurance-summary/estimate-page-count";
import { LifeInsuranceSummaryPagePdf } from "./pages/life-insurance-summary/page-pdf";
import { LifeInsuranceSummaryOptionsControl } from "./pages/life-insurance-summary/options-control";
import { MonteCarloPagePdf } from "./pages/monte-carlo/page-pdf";
import { MonteCarloOptionsControl } from "./pages/monte-carlo/options-control";
import {
  monteCarloOptionsSchema,
  MONTE_CARLO_OPTIONS_DEFAULT,
  type MonteCarloPageOptions,
} from "@/lib/presentations/pages/monte-carlo/options-schema";
import { summarizeMonteCarloOptions } from "@/lib/presentations/pages/monte-carlo/summarize-options";
import {
  buildMonteCarloData,
  type MonteCarloPageData,
  type MonteCarloReportPayload,
} from "@/lib/presentations/pages/monte-carlo/view-model";
import { AssetAllocationPagePdf } from "./pages/asset-allocation/page-pdf";
import { AssetAllocationOptionsControl } from "./pages/asset-allocation/options-control";
import { PortfolioAnalysisOptionsControl } from "./pages/portfolio-analysis/options-control";
import {
  assetAllocationOptionsSchema,
  ASSET_ALLOCATION_OPTIONS_DEFAULT,
  type AssetAllocationOptions,
} from "@/lib/presentations/pages/asset-allocation/options-schema";
import { summarizeAssetAllocationOptions } from "@/lib/presentations/pages/asset-allocation/summarize-options";
import { estimateAssetAllocationPageCount } from "@/lib/presentations/pages/asset-allocation/estimate-page-count";
import {
  buildAssetAllocationData,
  type AssetAllocationData,
} from "@/lib/presentations/pages/asset-allocation/view-model";
import { PortfolioAnalysisPagePdf } from "./pages/portfolio-analysis/page-pdf";
import {
  portfolioAnalysisOptionsSchema,
  PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT,
  type PortfolioAnalysisOptions,
} from "@/lib/presentations/pages/portfolio-analysis/options-schema";
import { summarizePortfolioAnalysisOptions } from "@/lib/presentations/pages/portfolio-analysis/summarize-options";
import { estimatePortfolioAnalysisPageCount } from "@/lib/presentations/pages/portfolio-analysis/estimate-page-count";
import {
  buildPortfolioAnalysisData,
  type PortfolioAnalysisData,
} from "@/lib/presentations/pages/portfolio-analysis/view-model";
import { buildScatterSpec } from "@/lib/presentations/charts/scatter-chart-spec";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import type {
  ScenarioChangesContext,
  ScenarioChangesPageData,
  ScenarioChangesOptions,
} from "@/lib/presentations/pages/scenario-changes/types";
import type { PageScenarioBundle } from "./document";
import { scenarioChangesOptionsSchema, SCENARIO_CHANGES_OPTIONS_DEFAULT } from "@/lib/presentations/pages/scenario-changes/options-schema";
import { summarizeScenarioChangesOptions } from "@/lib/presentations/pages/scenario-changes/summarize-options";
import { estimateScenarioChangesPageCount } from "@/lib/presentations/pages/scenario-changes/estimate-page-count";
import { buildScenarioChangesData } from "@/lib/presentations/pages/scenario-changes/view-model";
import { ScenarioChangesPagePdf } from "./pages/scenario-changes/page-pdf";
import { ScenarioChangesOptionsControl } from "./pages/scenario-changes/options-control";
import {
  retirementComparisonOptionsSchema,
  RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
} from "@/lib/presentations/pages/retirement-comparison/options-schema";
import { summarizeRetirementComparisonOptions } from "@/lib/presentations/pages/retirement-comparison/summarize-options";
import { estimateRetirementComparisonPageCount } from "@/lib/presentations/pages/retirement-comparison/estimate-page-count";
import { buildRetirementComparisonData } from "@/lib/presentations/pages/retirement-comparison/view-model";
import type {
  RetirementComparisonOptions,
  RetirementComparisonPageData,
} from "@/lib/presentations/pages/retirement-comparison/types";
import { RetirementComparisonPagePdf } from "./pages/retirement-comparison/page-pdf";
import { RetirementComparisonOptionsControl } from "./pages/retirement-comparison/options-control";
import {
  balanceSheetOptionsSchema,
  BALANCE_SHEET_OPTIONS_DEFAULT,
  type BalanceSheetOptions,
} from "@/lib/presentations/pages/balance-sheet/options-schema";
import { summarizeBalanceSheetOptions } from "@/lib/presentations/pages/balance-sheet/summarize-options";
import {
  estimateBalanceSheetPageCount,
  estimateEntitiesBalanceSheetPageCount,
} from "@/lib/presentations/pages/balance-sheet/estimate-page-count";
import {
  buildBalanceSheetPageData,
  type BalanceSheetPageData,
} from "@/lib/presentations/pages/balance-sheet/view-model";
import { BalanceSheetOptionsControl } from "./pages/balance-sheet/options-control";
import { BalanceSheetPagePdf } from "./pages/balance-sheet/page-pdf";
import { EntitiesBalanceSheetPagePdf } from "./pages/entities-balance-sheet/page-pdf";
import {
  blankOptionsSchema,
  BLANK_PAGE_OPTIONS_DEFAULT,
  type BlankPageOptions,
} from "@/lib/presentations/pages/blank/options-schema";
import { summarizeBlankOptions } from "@/lib/presentations/pages/blank/summarize-options";
import { buildBlankPageData, type BlankPageData } from "@/lib/presentations/pages/blank/view-model";
import { BlankOptionsControl } from "./pages/blank/options-control";
import { BlankPagePdf } from "./pages/blank/page-pdf";

export const CATEGORY_ORDER = [
  "Framing",
  "Cash Flow",
  "Income Tax",
  "Assets",
  "Insurance",
  "Estate",
  "Monte Carlo",
  "Comparison",
  "Retirement",
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
  /** Spouse surname from the CRM contact; null when solo or unknown. */
  spouseLastName: string | null;
  firmName: string;
  firmTagline: string | null;
  reportDate: string;
  /** Cover branding: cream-panel logo data URL (firm logo or Foundry default;
   *  null falls back to a firm-name wordmark) and the accent color for the
   *  diagonal stripes/rules (firm primaryColor or the report gold fallback). */
  firmLogoDataUrl: string | null;
  accentColor: string;
  /** Present only when the deck includes a Monte Carlo page; the export route
   *  runs the sim server-side and injects the compact payload. Null/undefined
   *  for every other deck — non-MC pages ignore it. */
  monteCarlo?: MonteCarloReportPayload | null;
  /** Present only when a deck includes an investment page; loaded conditionally. */
  investments?: InvestmentsBundle;
  /** Present only when the deck includes the Life Insurance Summary page;
   *  loaded conditionally in the export route. */
  lifeInsurance?: LifeInsuranceInventory;
  /** Present only when the deck includes the Scenario Changes page and the
   *  active ref is a live scenario; absent for base/snapshot decks. */
  scenarioChanges?: ScenarioChangesContext;
  /** Present only for multi-scenario pages (those that define
   *  `requiredScenarioRefs`). Keyed by `keyForRef` — e.g. "base",
   *  "scenario:<id>". Each entry is the fully-built bundle for that ref. */
  bundlesByRef?: Record<string, PageScenarioBundle>;
}

export interface RenderPdfInput<TData> {
  data: TData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  /**
   * Section accent for this page. Threaded as an explicit prop (not React
   * context): the PDF tree is rendered via `renderToStream` from a route
   * handler, which runs against React's `react-server` build where
   * `createContext` does not exist.
   */
  accent: SectionAccent;
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
  /** Optional: a multi-scenario page declares every scenario ref it needs (raw
   *  tokens: "base" | "<scenarioId>" | "snap:<id>"). The planner loads each and
   *  the document exposes them via `BuildDataContext.bundlesByRef`. */
  requiredScenarioRefs?: (options: TOptions) => string[];
  /** Optional: surface an inline scenario picker in the launcher row that edits
   *  a scenario id stored *inside* this page's options — e.g. Retirement
   *  Comparison's "compare to" scenario. The baseline is always Base Case, so
   *  the picker lists only live scenarios (no override / "Base case" choice).
   *  Mutually exclusive with `supportsScenarioOverride`, which owns the row's
   *  trailing control when true. */
  inlineScenarioOption?: {
    get: (options: TOptions) => string;
    set: (options: TOptions, scenarioId: string) => TOptions;
    /** Leading/empty option label shown when no scenario is picked. */
    placeholder: string;
  };
  buildData: (ctx: BuildDataContext, options: TOptions) => TData;
  renderPdf: (input: RenderPdfInput<TData>) => ReactElement;
}

export const cashFlowPage: PresentationPage<CashFlowPageData, CashFlowPageOptions> = {
  id: "cashFlow",
  title: "Cash Flow",
  description: "Annual income, expenses, withdrawals, and portfolio totals.",
  category: "Cash Flow",
  defaultOptions: CASH_FLOW_PAGE_OPTIONS_DEFAULT,
  optionsSchema: drillOptionsSchema,
  summarizeOptions: summarizeDrillOptions,
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
    // Full spouse name so `formatHouseholdName` keeps a different surname
    // ("Alan Bradshaw & Teresa Cox") instead of folding on the primary's.
    spouseName: ctx.spouseName
      ? `${ctx.spouseName}${ctx.spouseLastName ? ` ${ctx.spouseLastName}` : ""}`.trim()
      : null,
    scenarioLabel: ctx.scenarioLabel,
    reportDate: ctx.reportDate,
    logoDataUrl: ctx.firmLogoDataUrl,
    accentColor: ctx.accentColor,
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
      logoDataUrl={data.logoDataUrl}
      accentColor={data.accentColor}
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
  buildData: (ctx) => ({ clientName: ctx.clientName }),
  renderPdf: ({ data, documentSections, firmName, reportDate }) => (
    <TocPdf
      sections={documentSections ?? []}
      firmName={firmName}
      clientName={data.clientName}
      reportDate={reportDate}
    />
  ),
};

export const clientProfilePage: PresentationPage<ClientProfilePageData, ClientProfilePageOptions> = {
  id: "clientProfile",
  title: "Client Profile",
  description: "Household snapshot: principals, children, cash inflows, and current vs. retirement expenses.",
  category: "Framing",
  defaultOptions: CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT,
  optionsSchema: clientProfileOptionsSchema,
  summarizeOptions: summarizeClientProfileOptions,
  estimatePageCount: estimateClientProfilePageCount,
  supportsScenarioOverride: true,
  buildData: (ctx) =>
    buildClientProfileData({
      years: ctx.years,
      clientData: ctx.clientData,
      scenarioLabel: ctx.scenarioLabel,
      clientName: ctx.clientName,
      spouseName: ctx.spouseName,
      spouseLastName: ctx.spouseLastName,
    }),
  renderPdf: (input) => <ClientProfilePagePdf {...input} />,
};

export const assumptionsPage: PresentationPage<AssumptionsPageData, AssumptionsPageOptions> = {
  id: "assumptions",
  title: "Assumptions",
  description: "Tax, growth & inflation, per-account growth rates, and capital market assumptions.",
  category: "Framing",
  defaultOptions: ASSUMPTIONS_OPTIONS_DEFAULT,
  optionsSchema: assumptionsOptionsSchema,
  summarizeOptions: summarizeAssumptionsOptions,
  estimatePageCount: estimateAssumptionsPageCount,
  OptionsControl: AssumptionsOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) =>
    buildAssumptionsData({
      clientData: ctx.clientData,
      years: ctx.years,
      investments: ctx.investments,
      scenarioLabel: ctx.scenarioLabel,
      options,
    }),
  renderPdf: (input) => <AssumptionsPagePdf {...input} />,
};

export const blankPage: PresentationPage<BlankPageData, BlankPageOptions> = {
  id: "blank",
  title: "Blank Page",
  description: "Free-form page with your own formatted text.",
  category: "Framing",
  defaultOptions: BLANK_PAGE_OPTIONS_DEFAULT,
  optionsSchema: blankOptionsSchema,
  summarizeOptions: summarizeBlankOptions,
  estimatePageCount: () => 1,
  OptionsControl: BlankOptionsControl,
  supportsScenarioOverride: false,
  buildData: (_ctx, options) => buildBlankPageData(options),
  renderPdf: (input) => <BlankPagePdf {...input} />,
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
  category: PresentationCategory = "Cash Flow",
): PresentationPage<DrillPageData, DrillPageOptions> {
  return {
    id,
    title,
    description,
    category,
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

// Estate drill pages mirror makeDrillPage but pass the full ProjectionResult
// (estate builders need ordering resolution + gift ledger + death events).
function makeEstateDrillPage(
  id: string,
  title: string,
  description: string,
  build: (input: EstateDrillInput) => DrillPageData,
): PresentationPage<DrillPageData, DrillPageOptions> {
  return {
    id,
    title,
    description,
    category: "Estate",
    defaultOptions: DRILL_PAGE_OPTIONS_DEFAULT,
    optionsSchema: drillOptionsSchema,
    summarizeOptions: summarizeDrillOptions,
    estimatePageCount: estimateDrillPageCount,
    OptionsControl: DrillOptionsControl,
    supportsScenarioOverride: true,
    buildData: (ctx, options) =>
      build({
        projection: ctx.projection,
        clientData: ctx.clientData,
        options,
        scenarioLabel: ctx.scenarioLabel,
        clientName: ctx.clientName,
        spouseName: ctx.spouseName,
      }),
    renderPdf: (input) => <DrillPagePdf {...input} />,
  };
}

export const estateTransferPage = makeEstateDrillPage(
  "estateTransfer",
  "Estate Transfer",
  "Year-by-year gross estate, taxes & expenses, net to heirs, and total to heirs (hypothetical death each year).",
  buildEstateTransferDrillData,
);

export const estateLiquidityPage = makeEstateDrillPage(
  "estateLiquidity",
  "Estate Liquidity",
  "Year-by-year insurance benefit, portfolio assets, transfer cost, and liquidity surplus/deficit.",
  buildEstateLiquidityDrillData,
);

export const estateGiftTaxPage = makeEstateDrillPage(
  "estateGiftTax",
  "Gift Tax",
  "Cumulative lifetime gifts, credit used, and gift tax per spouse with combined totals.",
  buildGiftTaxDrillData,
);

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

export const entityCashFlowPage: PresentationPage<EntityCashFlowPageData, EntityCashFlowPageOptions> = {
  id: "entityCashFlow",
  title: "Business & Trusts",
  description: "Cash flow for a single trust or business — income, expenses, growth, and balances over time.",
  category: "Cash Flow",
  defaultOptions: ENTITY_CASH_FLOW_OPTIONS_DEFAULT,
  optionsSchema: entityCashFlowOptionsSchema,
  summarizeOptions: summarizeEntityCashFlowOptions,
  estimatePageCount: estimateEntityCashFlowPageCount,
  OptionsControl: EntityCashFlowOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) =>
    buildEntityCashFlowPageData({
      years: ctx.years,
      entityId: options.entityId,
      entityName: options.entityName,
      range: options.range,
      scenarioLabel: ctx.scenarioLabel,
    }),
  renderPdf: (input) => <EntityCashFlowPagePdf {...input} />,
};

// ─────────────────────────────────────────────────────────────────────────────
// Income Tax pages — mirror the in-app Income Tax report tabs. Summary pages
// (Income, Federal, State) carry stacked-bar charts; the deduction/other-tax
// and bracket drills are table-only.
// ─────────────────────────────────────────────────────────────────────────────

export const incomeTaxIncomePage = makeDrillPage(
  "incomeTaxIncome",
  "Income Tax — Income",
  "Annual income breakdown: earned, taxable Social Security, ordinary, dividends, capital gains, QBI, and totals.",
  buildTaxIncomeDrillData,
  "Income Tax",
);

export const incomeTaxFederalPage = makeDrillPage(
  "incomeTaxFederal",
  "Income Tax — Federal",
  "Federal tax waterfall: total income through AGI, deductions, taxable income, regular tax, other taxes, total tax, and marginal rate.",
  buildTaxFederalDrillData,
  "Income Tax",
);

export const incomeTaxStatePage = makeDrillPage(
  "incomeTaxState",
  "Income Tax — State",
  "State tax flow: federal base, add-backs, subtractions, state AGI, deductions, state taxable income, and state tax.",
  buildTaxStateDrillData,
  "Income Tax",
);

export const incomeTaxAboveLinePage = makeDrillPage(
  "incomeTaxAboveLine",
  "Income Tax — Above-Line Deductions",
  "Above-the-line deduction components: retirement contributions, tagged expenses, and manual entries.",
  buildTaxAboveLineDrillData,
  "Income Tax",
);

export const incomeTaxBelowLinePage = makeDrillPage(
  "incomeTaxBelowLine",
  "Income Tax — Below-Line Deductions",
  "Itemized deduction components, the itemized total, the standard deduction, and the deduction taken.",
  buildTaxBelowLineDrillData,
  "Income Tax",
);

export const incomeTaxOtherTaxesPage = makeDrillPage(
  "incomeTaxOtherTaxes",
  "Income Tax — Other Taxes",
  "Taxes beyond regular federal income tax: capital gains tax, AMT, NIIT, additional Medicare, FICA, and state tax.",
  buildTaxOtherTaxesDrillData,
  "Income Tax",
);

export const incomeTaxBracketFederalPage = makeDrillPage(
  "incomeTaxBracketFederal",
  "Income Tax — Tax Bracket (Federal)",
  "Federal bracket stacking: Roth conversions, income tax base, marginal rate, amount into and remaining in the marginal bracket.",
  buildTaxBracketFederalDrillData,
  "Income Tax",
);

export const incomeTaxBracketStatePage = makeDrillPage(
  "incomeTaxBracketState",
  "Income Tax — Tax Bracket (State)",
  "State bracket stacking: state taxable income, marginal rate, amount into and remaining in the marginal bracket, and state tax.",
  buildTaxBracketStateDrillData,
  "Income Tax",
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

export const estateSummaryPage: PresentationPage<EstateSummaryPageData, EstateSummaryOptions> = {
  id: "estateSummary",
  title: "Estate Summary",
  description: "One-page estate overview: gross estate & taxes today vs. end of life, and per-heir outright/in-trust distributions.",
  category: "Estate",
  defaultOptions: ESTATE_SUMMARY_OPTIONS_DEFAULT,
  optionsSchema: estateSummaryOptionsSchema,
  summarizeOptions: summarizeEstateSummaryOptions,
  estimatePageCount: estimateEstateSummaryPageCount,
  // No OptionsControl in v1 — ordering defaults to primaryFirst. A control can be
  // added later mirroring EstateOptionsControl (ordering segment only).
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildEstateSummaryData(ctx, options),
  renderPdf: (input) => <EstateSummaryPagePdf {...input} />,
};

export const monteCarloPage: PresentationPage<MonteCarloPageData, MonteCarloPageOptions> = {
  id: "monteCarlo",
  title: "Monte Carlo",
  description: "Probability of success, portfolio fan, ending distribution, and longevity.",
  category: "Monte Carlo",
  defaultOptions: MONTE_CARLO_OPTIONS_DEFAULT,
  optionsSchema: monteCarloOptionsSchema,
  summarizeOptions: summarizeMonteCarloOptions,
  // Data-independent estimate (document.tsx calls this with no data): the
  // dashboard page + a typical one-page yearly table. Long horizons may spill
  // to a 3rd physical page — same numbering limitation as the cash-flow drills.
  estimatePageCount: () => 2,
  OptionsControl: MonteCarloOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildMonteCarloData(ctx, options),
  renderPdf: (input) => <MonteCarloPagePdf {...input} />,
};

// ─────────────────────────────────────────────────────────────────────────────
// Investments pages — backed by InvestmentsBundle loaded at export time.
// Both pages guard a missing bundle and render gracefully.
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_ALLOCATION_DATA: AssetAllocationData = {
  subtitle: "No investment data available for this client.",
  leftName: "Current allocation",
  rightName: null,
  leftDonut: { kind: "donut", size: 150, rings: [], legend: [] },
  rightDonut: null,
  tableRows: [],
  diffRows: null,
  excludedRows: [],
  excludedTotal: 0,
  disclosure: "",
};

export const assetAllocationPage: PresentationPage<AssetAllocationData, AssetAllocationOptions> = {
  id: "assetAllocation",
  title: "Asset Allocation",
  description: "Compare any two allocations — investment groups or model portfolios — side by side, with per-class difference.",
  category: "Assets",
  defaultOptions: ASSET_ALLOCATION_OPTIONS_DEFAULT,
  optionsSchema: assetAllocationOptionsSchema,
  summarizeOptions: summarizeAssetAllocationOptions,
  estimatePageCount: estimateAssetAllocationPageCount,
  OptionsControl: AssetAllocationOptionsControl,
  supportsScenarioOverride: false,
  buildData: (ctx, options) => {
    if (!ctx.investments) return EMPTY_ALLOCATION_DATA;
    return buildAssetAllocationData(ctx.investments, options);
  },
  renderPdf: (input) => <AssetAllocationPagePdf {...input} />,
};

export const portfolioAnalysisPage: PresentationPage<PortfolioAnalysisData, PortfolioAnalysisOptions> = {
  id: "portfolioAnalysis",
  title: "Portfolio Analysis",
  description: "Risk/return scatter of selected entities with a detail table.",
  category: "Assets",
  defaultOptions: PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT,
  optionsSchema: portfolioAnalysisOptionsSchema,
  summarizeOptions: summarizePortfolioAnalysisOptions,
  estimatePageCount: estimatePortfolioAnalysisPageCount,
  OptionsControl: PortfolioAnalysisOptionsControl,
  supportsScenarioOverride: false,
  buildData: (ctx, options) => {
    if (!ctx.investments) {
      return { scatter: buildScatterSpec([]), tableRows: [], unplottable: [] };
    }
    return buildPortfolioAnalysisData(ctx.investments, options);
  },
  renderPdf: (input) => <PortfolioAnalysisPagePdf {...input} />,
};

export const balanceSheetPage: PresentationPage<BalanceSheetPageData, BalanceSheetOptions> = {
  id: "balanceSheet",
  title: "Balance Sheet",
  description: "Net worth, total assets, liabilities, and liquid portfolio with asset & liability detail.",
  category: "Assets",
  defaultOptions: BALANCE_SHEET_OPTIONS_DEFAULT,
  optionsSchema: balanceSheetOptionsSchema,
  summarizeOptions: summarizeBalanceSheetOptions,
  estimatePageCount: estimateBalanceSheetPageCount,
  OptionsControl: BalanceSheetOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildBalanceSheetPageData(ctx, options, "consolidated"),
  renderPdf: (input) => <BalanceSheetPagePdf {...input} />,
};

export const entitiesBalanceSheetPage: PresentationPage<BalanceSheetPageData, BalanceSheetOptions> = {
  id: "entitiesBalanceSheet",
  title: "Balance Sheet — Entities",
  description: "Per-entity balance sheets — assets, liabilities, and net worth for each trust and business.",
  category: "Assets",
  defaultOptions: BALANCE_SHEET_OPTIONS_DEFAULT,
  optionsSchema: balanceSheetOptionsSchema,
  summarizeOptions: summarizeBalanceSheetOptions,
  estimatePageCount: estimateEntitiesBalanceSheetPageCount,
  OptionsControl: BalanceSheetOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildBalanceSheetPageData(ctx, options, "entities"),
  renderPdf: (input) => <EntitiesBalanceSheetPagePdf {...input} />,
};

export const scenarioChangesPage: PresentationPage<ScenarioChangesPageData, ScenarioChangesOptions> = {
  id: "scenarioChanges",
  title: "Scenario Changes",
  description: "Plain-English table of the edits made in this scenario vs the base plan.",
  category: "Comparison",
  defaultOptions: SCENARIO_CHANGES_OPTIONS_DEFAULT,
  optionsSchema: scenarioChangesOptionsSchema,
  summarizeOptions: summarizeScenarioChangesOptions,
  estimatePageCount: estimateScenarioChangesPageCount,
  OptionsControl: ScenarioChangesOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildScenarioChangesData(ctx.scenarioChanges, options),
  renderPdf: (input) => <ScenarioChangesPagePdf {...input} />,
};

export const retirementComparisonPage: PresentationPage<RetirementComparisonPageData, RetirementComparisonOptions> = {
  id: "retirementComparison",
  title: "Retirement Comparison",
  description: "Why the proposed plan wins vs. the base case — verdict, portfolio overlay, maximum sustainable spending, confidence range, and an AI summary.",
  category: "Comparison",
  defaultOptions: RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
  optionsSchema: retirementComparisonOptionsSchema,
  summarizeOptions: summarizeRetirementComparisonOptions,
  estimatePageCount: () => estimateRetirementComparisonPageCount(),
  OptionsControl: RetirementComparisonOptionsControl,
  supportsScenarioOverride: false,
  requiredScenarioRefs: (o) => (o.scenarioId ? ["base", o.scenarioId] : ["base"]),
  inlineScenarioOption: {
    get: (o) => o.scenarioId,
    set: (o, scenarioId) => ({ ...o, scenarioId }),
    placeholder: "Compare to…",
  },
  buildData: (ctx, options) => buildRetirementComparisonData(ctx, options),
  renderPdf: (input) => <RetirementComparisonPagePdf {...input} />,
};

export const taxSummaryPage: PresentationPage<TaxSummaryPageData, TaxSummaryOptions> = {
  id: "taxSummary",
  title: "Tax Summary",
  description: "One-page lifetime tax overview: federal/state/cap-gains totals, bracket exposure, and Roth vs pre-tax at retirement.",
  category: "Income Tax",
  defaultOptions: TAX_SUMMARY_OPTIONS_DEFAULT,
  optionsSchema: taxSummaryOptionsSchema,
  summarizeOptions: summarizeTaxSummaryOptions,
  estimatePageCount: () => estimateTaxSummaryPageCount(),
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildTaxSummaryData(ctx, options),
  renderPdf: (input) => <TaxSummaryPagePdf {...input} />,
};

export const taxComparisonPage: PresentationPage<TaxComparisonPageData, TaxComparisonOptions> = {
  id: "taxComparison",
  title: "Tax Comparison",
  description: "Base Case vs. a selected scenario: lifetime tax deltas, taxes-by-year with a base overlay, bracket-exposure change, and the Roth/pre-tax/taxable shift at retirement.",
  category: "Comparison",
  defaultOptions: TAX_COMPARISON_OPTIONS_DEFAULT,
  optionsSchema: taxComparisonOptionsSchema,
  summarizeOptions: summarizeTaxComparisonOptions,
  estimatePageCount: () => estimateTaxComparisonPageCount(),
  supportsScenarioOverride: false,
  requiredScenarioRefs: (o) => (o.scenarioId ? ["base", o.scenarioId] : ["base"]),
  inlineScenarioOption: {
    get: (o) => o.scenarioId,
    set: (o, scenarioId) => ({ ...o, scenarioId }),
    placeholder: "Compare to…",
  },
  buildData: (ctx, options) => buildTaxComparisonData(ctx, options),
  renderPdf: (input) => <TaxComparisonPagePdf {...input} />,
};

export const medicareSummaryPage: PresentationPage<MedicareSummaryPageData, MedicareSummaryOptions> = {
  id: "medicareSummary",
  title: "Medicare & IRMAA Summary",
  description: "One-page Medicare overview: lifetime premiums, the IRMAA income surcharge, tier exposure over time, and survivor/RMD risks.",
  category: "Retirement",
  defaultOptions: MEDICARE_SUMMARY_OPTIONS_DEFAULT,
  optionsSchema: medicareSummaryOptionsSchema,
  summarizeOptions: summarizeMedicareSummaryOptions,
  estimatePageCount: () => estimateMedicareSummaryPageCount(),
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildMedicareSummaryData(ctx, options),
  renderPdf: (input) => <MedicareSummaryPagePdf {...input} />,
};

export const retirementSummaryPage: PresentationPage<RetirementSummaryPageData, RetirementSummaryOptions> = {
  id: "retirementSummary",
  title: "Retirement Summary",
  description: "Two-page retirement overview: asset trajectory & Monte Carlo, Social Security 62–70, spending, and lifetime funding sources.",
  category: "Retirement",
  defaultOptions: RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
  optionsSchema: retirementSummaryOptionsSchema,
  summarizeOptions: summarizeRetirementSummaryOptions,
  estimatePageCount: () => estimateRetirementSummaryPageCount(),
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildRetirementSummaryData(ctx, options),
  renderPdf: (input) => <RetirementSummaryPagePdf {...input} />,
};

export const lifeInsuranceSummaryPage: PresentationPage<
  LifeInsuranceSummaryPageData,
  LifeInsuranceSummaryOptions
> = {
  id: "lifeInsuranceSummary",
  title: "Life Insurance Summary",
  description:
    "Two-page life insurance overview: policy inventory + beneficiaries, then Monte-Carlo coverage-vs-need and the need-over-time chart.",
  category: "Insurance",
  defaultOptions: LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT,
  optionsSchema: lifeInsuranceSummaryOptionsSchema,
  summarizeOptions: summarizeLifeInsuranceSummaryOptions,
  estimatePageCount: () => estimateLifeInsuranceSummaryPageCount(),
  OptionsControl: LifeInsuranceSummaryOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) => buildLifeInsuranceSummaryData(ctx, options),
  renderPdf: (input) => <LifeInsuranceSummaryPagePdf {...input} />,
};

export const PRESENTATION_PAGES = {
  cover: coverPage,
  toc: tocPage,
  clientProfile: clientProfilePage,
  assumptions: assumptionsPage,
  blank: blankPage,
  cashFlow: cashFlowPage,
  cashFlowIncome: cashFlowIncomePage,
  cashFlowExpenses: cashFlowExpensesPage,
  cashFlowSavings: cashFlowSavingsPage,
  cashFlowNet: cashFlowNetPage,
  cashFlowGrowth: cashFlowGrowthPage,
  cashFlowActivity: cashFlowActivityPage,
  cashFlowAssets: cashFlowAssetsPage,
  entityCashFlow: entityCashFlowPage,
  taxSummary: taxSummaryPage,
  taxComparison: taxComparisonPage,
  medicareSummary: medicareSummaryPage,
  retirementSummary: retirementSummaryPage,
  incomeTaxIncome: incomeTaxIncomePage,
  incomeTaxFederal: incomeTaxFederalPage,
  incomeTaxState: incomeTaxStatePage,
  incomeTaxAboveLine: incomeTaxAboveLinePage,
  incomeTaxBelowLine: incomeTaxBelowLinePage,
  incomeTaxOtherTaxes: incomeTaxOtherTaxesPage,
  incomeTaxBracketFederal: incomeTaxBracketFederalPage,
  incomeTaxBracketState: incomeTaxBracketStatePage,
  estateTransfer: estateTransferPage,
  estateLiquidity: estateLiquidityPage,
  estateGiftTax: estateGiftTaxPage,
  estateFlowChart: estateFlowChartPage,
  estateFlow: estateFlowReportPage,
  estateSummary: estateSummaryPage,
  monteCarlo: monteCarloPage,
  assetAllocation: assetAllocationPage,
  portfolioAnalysis: portfolioAnalysisPage,
  balanceSheet: balanceSheetPage,
  entitiesBalanceSheet: entitiesBalanceSheetPage,
  scenarioChanges: scenarioChangesPage,
  retirementComparison: retirementComparisonPage,
  lifeInsuranceSummary: lifeInsuranceSummaryPage,
} as const;

export type PresentationPageId = keyof typeof PRESENTATION_PAGES;
