// src/lib/presentations/pages/scenario-comparison/bands.ts
import type { GainCost, MetricRow, TradeoffBand } from "./types";
import type { ScenarioColumnInput } from "./metrics";

const MAX_CHANGE_LINES = 4;
const MAX_PER_SIDE = 3;

/** Rows that earn a headline chip on a band, in display order. */
const CHIP_ROWS = ["Plan confidence", "Max sustainable spending", "Assets end of life"];

/** Priority order for capping each side of the Gains/Costs strip at three
 *  entries (spec §4/§5). The strip mixes percentage points, dollars and year
 *  counts, so sorting by raw magnitude would always rank a dollar move above
 *  a confidence move — the headline metric ("Plan confidence") would never
 *  survive the cap. Priority order keeps the headline metrics visible
 *  regardless of how large the dollar deltas are. Rows outside this list
 *  keep their natural (row) order, stably, after the ranked ones. */
const SIDE_PRIORITY = [
  "Plan confidence",
  "Max sustainable spending",
  "Lifetime taxes — total",
  "Assets end of life",
  "Net to heirs",
];

/** Orders entries by SIDE_PRIORITY, then by their original (row) order for
 *  anything not in that list. Array.prototype.sort is stable, so ties keep
 *  the order they arrived in. */
function byPriority(entries: GainCost[]): GainCost[] {
  const rank = (label: string) => {
    const i = SIDE_PRIORITY.indexOf(label);
    return i === -1 ? SIDE_PRIORITY.length : i;
  };
  return [...entries].sort((a, b) => rank(a.label) - rank(b.label));
}

export interface TradeoffBandsInput {
  /** Index 0 is Base Case; bands are built for indices 1+. */
  columns: ScenarioColumnInput[];
  rows: MetricRow[];
  /** Index-aligned with `columns`. */
  colors: string[];
  changeLinesByScenario: Record<string, string[]>;
  narrativesByScenario: Record<string, string>;
}

function chipsFor(rows: MetricRow[], col: number) {
  return CHIP_ROWS.flatMap((label) => {
    const row = rows.find((r) => r.label === label);
    if (!row) return [];
    const cell = row.cells[col];
    if (!cell) return [];
    return [{ label, value: cell.value, delta: cell.delta, direction: cell.direction }];
  });
}

export function buildTradeoffBands(input: TradeoffBandsInput): TradeoffBand[] {
  const { columns, rows, colors, changeLinesByScenario, narrativesByScenario } = input;

  return columns.slice(1).map((c, i) => {
    const col = i + 1;
    const gains: GainCost[] = [];
    const costs: GainCost[] = [];

    for (const row of rows) {
      const cell = row.cells[col];
      if (!cell?.delta || cell.direction === 0) continue;
      // Indented sub-rows (federal / state) are folded into the total above
      // them; listing all three would triple-count one tax move.
      if (row.indent) continue;
      const entry: GainCost = { label: row.label, amount: cell.delta };
      (cell.direction === 1 ? gains : costs).push(entry);
    }

    const allLines = changeLinesByScenario[c.refKey] ?? [];

    return {
      scenarioId: c.refKey,
      name: c.name,
      color: colors[col] ?? colors[colors.length - 1],
      chips: chipsFor(rows, col),
      changeLines: allLines.slice(0, MAX_CHANGE_LINES),
      moreChangeCount: Math.max(0, allLines.length - MAX_CHANGE_LINES),
      narrative: narrativesByScenario[c.refKey] ?? "",
      gains: byPriority(gains).slice(0, MAX_PER_SIDE),
      costs: byPriority(costs).slice(0, MAX_PER_SIDE),
    };
  });
}
