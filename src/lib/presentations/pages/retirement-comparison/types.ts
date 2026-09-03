// src/lib/presentations/pages/retirement-comparison/types.ts
import type { TaxBuckets } from "./tax-buckets";

export interface RetirementComparisonAiConfig {
  tone: "concise" | "detailed" | "plain";
  length: "short" | "medium" | "long";
  customInstructions: string;
  /** Stored markdown rendered in the PDF. Empty until generated. */
  generatedText: string;
  /** ISO timestamp of the last generation, or null. */
  generatedAt: string | null;
  /** Hash of the inputs at generation time (staleness hint). */
  sourceHash: string | null;
}

export interface RetirementComparisonOptions {
  /** The left-hand plan. "base" = Base Case; otherwise a live scenario id.
   *  Never empty — a comparison always has a baseline, unlike `scenarioId`,
   *  whose "" means "unset, render the empty state". */
  baselineScenarioId: string;
  /** The comparison scenario id — the right-hand plan; "" = unset, render the
   *  empty state. */
  scenarioId: string;
  showPortfolioMatrix: boolean;
  showAiSummary: boolean;
  showConfidenceRange: boolean;
  maxSpend: { show: boolean; targetConfidence: number };
  ai: RetirementComparisonAiConfig;
}

/** One KPI: the same metric for both plans, plus the delta. */
export interface ComparisonKpi {
  label: string;
  base: string;       // formatted
  scenario: string;   // formatted
  deltaLabel: string; // formatted signed delta, e.g. "+19 pts" / "+$1.2M"
  /** Direction for coloring: 1 good, -1 bad, 0 neutral. */
  direction: 1 | -1 | 0;
}

export interface PortfolioMatrixCell {
  total: number;
  cash: number;
  retirement: number;
  taxable: number;
}

export interface PortfolioMatrix {
  /** The year each side was actually measured at. The two plans retire in
   *  different years, and a projection that runs short is read at its last
   *  row — so neither horizon can be labelled with a single number. */
  baseRetirementYear: number;
  scenarioRetirementYear: number;
  baseEndYear: number;
  scenarioEndYear: number;
  baseAtRetirement: PortfolioMatrixCell;
  scenarioAtRetirement: PortfolioMatrixCell;
  baseAtEnd: PortfolioMatrixCell;
  scenarioAtEnd: PortfolioMatrixCell;
}

export interface OverlayBar {
  year: number;
  floor: number;        // blue
  scenarioAhead: number; // green
  baseAhead: number;     // grey
}

export interface VerdictBanner {
  headline: string;   // "91% chance your plan fully funds your life — up from 73%"
}

export interface MaxSpendPoint { year: number; base: number; scenario: number } // nominal $

export interface MaxSpendBlock {
  show: boolean;
  baseToday: number;       // today's $, rounded $5k
  scenarioToday: number;   // today's $, rounded $5k
  series: MaxSpendPoint[];  // inflated forward, retirement → end of life
}

export interface ConfidencePoint {
  year: number;
  baseP20: number; baseP50: number; baseP80: number;
  scnP20: number; scnP50: number; scnP80: number;
}

export interface ConfidenceBlock { show: boolean; points: ConfidencePoint[] }

/** One page-1 headline KPI: the same metric for both plans, plus a signed
 *  delta. `show` is false when the underlying figure is unavailable. */
export interface KpiCard {
  label: string;
  base: string;       // formatted
  scenario: string;   // formatted
  delta: string;      // formatted signed delta, e.g. "+16 pts" / "+$23.6M"
  /** Whether the move is favorable, for coloring: 1 good, -1 bad, 0 neutral.
   *  The sign of the delta cannot stand in for this — retiring earlier prints
   *  "−5 yrs" and is good — and two of these five metrics point opposite ways,
   *  so the renderers have nothing to derive it from. Set in the view-model
   *  beside each delta so both surfaces color the same number the same way. */
  direction: 1 | -1 | 0;
  show: boolean;
}

/** Liquid portfolio assets at one horizon, split by tax treatment, for both
 *  plans. Drives the page-1 at-retirement comparison and the page-2 condensed
 *  end-of-life table. Zero buckets are hidden at render time. */
export interface TaxTreatmentBreakdown {
  /** The year each side was actually measured at — see PortfolioMatrix. */
  baseYear: number;
  scenarioYear: number;
  base: TaxBuckets;
  scenario: TaxBuckets;
}

export interface RetirementComparisonPageData {
  title: string;
  subtitle: string;
  /** Full display names of the two plans. The subtitle carries them at length;
   *  the PDF's fixed-width columns and its SVG axis truncate them via
   *  `truncateLabel`, each with its own separately measured cap. */
  baselineLabel: string;
  scenarioLabel: string;
  isEmpty: boolean;
  verdict: VerdictBanner;
  /** Page-1 headline strip — the metrics that improve (success, legacy, max
   *  spend, downside). Always built; individual cards self-hide when missing. */
  kpis: KpiCard[];
  overlay: OverlayBar[];
  /** Page-1 composition comparison: assets by tax treatment at retirement. */
  atRetirement: TaxTreatmentBreakdown;
  /** Page-2 condensed matrix: assets by tax treatment at end of life. */
  atEndOfLife: TaxTreatmentBreakdown;
  maxSpend: MaxSpendBlock;
  confidence: ConfidenceBlock;
  showPortfolioMatrix: boolean;
  showAiSummary: boolean;
  aiMarkdown: string;
}
