// src/lib/reports/types.ts
//
// Persisted shapes (stored as jsonb) and runtime shapes for the reports
// builder. The persisted variant strips React-only fields; in v1 they're
// identical, so the alias is conceptual but cheap.

export type RowSize = "1-up" | "2-up" | "3-up" | "4-up";
export type PageOrientation = "portrait" | "landscape";

export type WidgetKind =
  | "cover"
  | "sectionHead"
  | "divider"
  | "advisorCommentary"
  | "kpiTile"
  | "cashflowBarChart"
  | "cashflowTable"
  | "incomeSourcesArea"
  | "netWorthLine"
  | "allocationDonut"
  | "monteCarloFan"
  | "balanceSheetTable"
  | "aiAnalysis";

// Per-widget prop shapes. Each widget task below pins down its own props.
// We declare them inline here (rather than per-widget files) so the
// reducer and registry have one canonical union to discriminate on.

export type CoverProps = { title: string; subtitle?: string; year?: number };
export type SectionHeadProps = { eyebrow: string; title: string };
export type DividerProps = Record<string, never>;
export type AdvisorCommentaryProps = { headline?: string; body: string; notes?: string };
export type KpiTileProps = {
  metricKey: string;            // resolved via metric-registry
  titleOverride?: string;
  subtitle?: string;
  showDelta?: boolean;
  notes?: string;
};
export type YearRange = { from: number | "default"; to: number | "default" };
export type OwnershipView = "consolidated" | "client" | "spouse" | "joint" | "entities";
export type CashflowBarChartProps = {
  title: string;
  subtitle?: string;
  yearRange: YearRange;
  ownership: OwnershipView;
  stacking: "stacked" | "grouped";
  showLegend: boolean;
  showGrid: boolean;
  notes?: string;
};
export type CashflowTableProps = {
  title: string;
  subtitle?: string;
  yearRange: YearRange;
  ownership: OwnershipView;
  showTotals: boolean;
  notes?: string;
};
export type IncomeSourcesSeries = "wages" | "socialSecurity" | "withdrawals" | "pensions" | "other";
export type IncomeSourcesAreaProps = {
  title: string;
  subtitle?: string;
  yearRange: YearRange;
  series: IncomeSourcesSeries[];
  notes?: string;
};
export type NetWorthLineProps = {
  title: string;
  subtitle?: string;
  yearRange: YearRange;
  ownership: OwnershipView;
  compareScenarioId?: string | null;
  showMarkers: boolean;
  showGrid: boolean;
  notes?: string;
};
export type AllocationDonutProps = {
  title: string;
  subtitle?: string;
  asOfYear: number | "current";
  innerRingAssetType: boolean;
  showLegend: boolean;
  notes?: string;
};
export type PercentileBand = 5 | 25 | 50 | 75 | 95;
export type MonteCarloFanProps = {
  title: string;
  subtitle?: string;
  yearRange: YearRange;
  scenarioId?: string | null;
  bands: PercentileBand[];
  showHeadline: boolean;
  notes?: string;
};
export type BalanceSheetTableProps = {
  title: string;
  subtitle?: string;
  asOfYear: number | "current";
  ownership: OwnershipView;
  showEntityBreakdown: boolean;
  notes?: string;
};
export type AiScope = "cashflow" | "balance" | "monteCarlo" | "tax" | "estate";
export type AiTone = "concise" | "detailed" | "plain";
export type AiLength = "short" | "medium" | "long";
export type AiAnalysisProps = {
  title?: string;
  scopes: AiScope[];
  tone: AiTone;
  length: AiLength;
  body: string;                 // markdown; empty initially
  generatedAt?: string;         // ISO; null until first generate
  notes?: string;
};

export type WidgetPropsByKind = {
  cover: CoverProps;
  sectionHead: SectionHeadProps;
  divider: DividerProps;
  advisorCommentary: AdvisorCommentaryProps;
  kpiTile: KpiTileProps;
  cashflowBarChart: CashflowBarChartProps;
  cashflowTable: CashflowTableProps;
  incomeSourcesArea: IncomeSourcesAreaProps;
  netWorthLine: NetWorthLineProps;
  allocationDonut: AllocationDonutProps;
  monteCarloFan: MonteCarloFanProps;
  balanceSheetTable: BalanceSheetTableProps;
  aiAnalysis: AiAnalysisProps;
};

export type Widget = {
  [K in WidgetKind]: { id: string; kind: K; props: WidgetPropsByKind[K] };
}[WidgetKind];

export type Row = {
  id: string;
  layout: RowSize;
  slots: (Widget | null)[];     // length must match layout
};

export type Page = {
  id: string;
  orientation: PageOrientation;
  rows: Row[];
};

export type ReportPagesPersisted = Page[];

/**
 * Two-scenario binding for plan-comparison reports. When non-null, the
 * data-loader resolves both projections and runs them through the
 * `comparison` scope. Both scenario ids must reference scenarios belonging
 * to the report's client; the API route validates this on write.
 */
export type ComparisonBinding = {
  currentScenarioId: string;
  proposedScenarioId: string;
};

export type Report = {
  id: string;
  firmId: string;
  clientId: string;
  title: string;
  templateKey: string | null;
  pages: Page[];
  comparisonBinding?: ComparisonBinding | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
};

// Helpers
export const SLOT_COUNT_BY_LAYOUT: Record<RowSize, number> = {
  "1-up": 1, "2-up": 2, "3-up": 3, "4-up": 4,
};
