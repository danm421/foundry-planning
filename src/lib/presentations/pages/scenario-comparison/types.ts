import type { ChartSpec } from "@/lib/presentations/charts/types";

/** Stored narrative for one scenario column. */
export interface ScenarioComparisonBandAi {
  generatedText: string;
  generatedAt: string | null;
  /** Hash of THIS band's own inputs. Not the assembled prompt — see ai-prompt.ts. */
  sourceHash: string | null;
}

export interface ScenarioComparisonOptions {
  /** 0-3 live scenario ids, in column order after Base Case. */
  scenarioIds: string[];
  maxSpend: { show: boolean; targetConfidence: number };
  showChart: boolean;
  showTradeoffBands: boolean;
  ai: {
    tone: "concise" | "detailed" | "plain";
    customInstructions: string;
    /** Keyed by scenario id so an edit to one band survives a change in another. */
    byScenario: Record<string, ScenarioComparisonBandAi>;
  };
}

/** Which direction of movement is favourable for a metric row. */
export type BetterIs = "higher" | "lower" | "neutral";

/** One cell: a column's value for a row, plus its delta vs. column 0. */
export interface MetricCell {
  /** Formatted value, or an em-dash when unavailable. */
  value: string;
  /** Formatted signed delta vs. Base Case; null on the base column and
   *  whenever either side is unavailable. */
  delta: string | null;
  /** Favourability of THIS cell's delta: 1 good, -1 bad, 0 neutral/none.
   *  Derived from the row's `betterIs`, never from the delta's sign. */
  direction: 1 | -1 | 0;
  /** True when this column holds the best value in its row. */
  isBest: boolean;
}

export interface MetricRow {
  label: string;
  /** Indented sub-row (the federal/state tax breakdown). */
  indent: boolean;
  betterIs: BetterIs;
  /** Index-aligned with `columns`. */
  cells: MetricCell[];
}

export interface ColumnHeader {
  /** "base" or the scenario id. */
  refKey: string;
  name: string;
  /** 1-3 short lines under the name. Base Case gets the fixed descriptor. */
  descriptor: string[];
  /** 0..1, or null when the Monte Carlo run was unavailable. */
  confidence: number | null;
  /** Resolved hex for this column's rule, meter and chart line. */
  color: string;
  /** At most two, deterministic. */
  badges: string[];
}

export interface GainCost {
  label: string;
  /** Formatted signed magnitude, e.g. "+9 pts" or a negative dollar delta. */
  amount: string;
}

export interface TradeoffBand {
  scenarioId: string;
  name: string;
  color: string;
  /** Three headline chips: value + signed delta. */
  chips: Array<{ label: string; value: string; delta: string | null; direction: 1 | -1 | 0 }>;
  /** Up to four change lines, then an optional "+N more". */
  changeLines: string[];
  moreChangeCount: number;
  /** Already truncated to the band's sentence budget. */
  narrative: string;
  gains: GainCost[];
  costs: GainCost[];
}

export interface ScenarioComparisonPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  columns: ColumnHeader[];
  rows: MetricRow[];
  chart: ChartSpec | null;
  bands: TradeoffBand[];
  /** Printed under the matrix when any Monte Carlo run was unavailable. */
  footnote: string;
}
