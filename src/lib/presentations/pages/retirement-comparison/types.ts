// src/lib/presentations/pages/retirement-comparison/types.ts

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

export interface VerdictBanner {
  headline: string;   // "91% chance your plan fully funds your life — up from 73%"
}

export interface MaxSpendPoint { year: number; base: number; scenario: number } // nominal $

export interface MaxSpendBlock {
  show: boolean;
  baseToday: number;       // today's $, rounded $2k
  scenarioToday: number;   // today's $, rounded $2k
  series: MaxSpendPoint[];  // inflated forward, retirement → end of life
}

export interface ConfidencePoint {
  year: number;
  baseP20: number; baseP50: number; baseP80: number;
  scnP20: number; scnP50: number; scnP80: number;
}

export interface ConfidenceBlock { show: boolean; points: ConfidencePoint[] }

export interface StatCard {
  show: boolean;
  base: string;       // formatted
  scenario: string;   // formatted
  delta: string;      // formatted signed delta or note ("Funded for life")
}

export interface RetirementComparisonPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  verdict: VerdictBanner;
  overlay: OverlayBar[];
  matrix: PortfolioMatrix | null;
  maxSpend: MaxSpendBlock;
  confidence: ConfidenceBlock;
  legacy: StatCard;       // always show
  taxSaved: StatCard;     // show only when favorable
  lastsToAge: StatCard;   // show only when favorable
  showPortfolioMatrix: boolean;
  showAiSummary: boolean;
  aiMarkdown: string;
}
