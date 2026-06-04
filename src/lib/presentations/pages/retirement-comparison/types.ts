// src/lib/presentations/pages/retirement-comparison/types.ts
import type { DisplayUnit } from "@/lib/presentations/pages/scenario-changes/types";

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
  /** The comparison scenario id; baseline is always Base Case. Empty = unset. */
  scenarioId: string;
  chartYearRange: { start: number; end: number } | null;
  showChanges: boolean;
  showPortfolioMatrix: boolean;
  showAiSummary: boolean;
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
  retirementYear: number;
  endOfLifeYear: number;
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

export interface RetirementComparisonPageData {
  title: string;
  subtitle: string;          // "Base Case vs. <scenario label>"
  isEmpty: boolean;          // no scenario selected / no data
  kpis: ComparisonKpi[];
  overlay: OverlayBar[];
  matrix: PortfolioMatrix | null;
  changeUnits: DisplayUnit[]; // reuse the scenario-changes display units
  showChanges: boolean;
  showPortfolioMatrix: boolean;
  showAiSummary: boolean;
  aiMarkdown: string;        // stored text ("" → placeholder)
}
