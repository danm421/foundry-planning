// The Tax Bracket chart's model — shared by the on-screen chart (solver and
// income-tax page) and the presentation's PDF sheet, so the three draw the same
// bars over the same floors. Framework-free: no React, no Chart.js.

import type { ProjectionYear } from "@/engine/types";
import type { BracketTier } from "./types";
import { buildTaxBracketRows, type TaxBracketRow } from "./bracket";

export interface BracketFillYear {
  year: number;
  /** Income tax base that did not come from a Roth conversion. Never negative. */
  otherIncome: number;
  /** The taxable part of the year's Roth conversions, capped at the base so
   *  the two slices always stack to exactly the income tax base. */
  conversion: number;
  /** The filing-status-resolved ladder the engine applied this year, in that
   *  year's dollars — so the floors rise with indexing and halve at a first death. */
  tiers: BracketTier[];
  /** The matching Tax Bracket table row: bracket, room used, room left, AMT. */
  row: TaxBracketRow;
}

export interface BracketFillModel {
  years: BracketFillYear[];
  /** Every distinct bracket rate seen across the projection, ascending.
   *  A rate's position here is its colour rank, so 22% wears the same colour
   *  on every chart however many floors happen to be in view. */
  rates: number[];
  /** Y-axis ceiling: a round number just above the tallest filled tier's top,
   *  so the room left in the bracket is visible without squashing the bars. */
  yMax: number;
}

const CEILING_HEADROOM = 1.08;
const TOP_TIER_HEADROOM = 1.15;

/** Round up to a tidy axis ceiling: quarter steps of the magnitude at
 *  $100k and above (…, 225k, 250k, …), half steps below it. */
function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const step = magnitude >= 100_000 ? magnitude / 4 : magnitude / 2;
  return Math.ceil(v / step) * step;
}

export function buildBracketFillModel(years: ProjectionYear[]): BracketFillModel {
  const byYear = new Map(years.map((y) => [y.year, y]));
  const rates = new Set<number>();
  const out: BracketFillYear[] = [];
  let ceiling = 0;

  for (const row of buildTaxBracketRows(years)) {
    const tiers = byYear.get(row.year)?.taxResult?.diag.incomeBracketsForFiling ?? [];
    for (const t of tiers) rates.add(t.rate);

    const base = Math.max(0, row.incomeTaxBase);
    const conversion = Math.min(base, Math.max(0, row.conversionTaxable));

    // `row.marginalRate` is the filled tier's rate (see pickFilledTier).
    const filledTop = tiers.find((t) => t.rate === row.marginalRate)?.to ?? null;
    ceiling = Math.max(
      ceiling,
      filledTop == null ? base * TOP_TIER_HEADROOM : filledTop * CEILING_HEADROOM,
    );

    out.push({ year: row.year, otherIncome: base - conversion, conversion, tiers, row });
  }

  return {
    years: out,
    rates: [...rates].sort((a, b) => a - b),
    yMax: niceCeil(ceiling),
  };
}

export interface BracketFloorSeries {
  rate: number;
  /** Position of `rate` in the model's ascending `rates` — the colour key. */
  rank: number;
  /** This bracket's floor in each model year, in that year's dollars. `NaN`
   *  in a year whose ladder carries no tier at this rate (a rate stressor or a
   *  law change part-way through the projection), so a renderer breaks the
   *  line there instead of bridging the gap with a floor nobody computed. */
  values: number[];
}

/**
 * The bracket floors worth drawing as lines over the bars — one per rate,
 * the way a client sees the ladder: the line a bar crosses is the bracket it
 * has climbed into. Two kinds are left out. A floor of $0 (the bottom
 * bracket's) would lie along the axis under every bar and say nothing. A floor
 * that never dips below the axis ceiling would be drawn nowhere and only pad
 * the legend.
 */
export function bracketFloorSeries(model: BracketFillModel): BracketFloorSeries[] {
  return model.rates.flatMap((rate, rank) => {
    const values = model.years.map(
      (y) => y.tiers.find((t) => t.rate === rate)?.from ?? NaN,
    );
    const drawn = values.some((v) => Number.isFinite(v) && v > 0 && v < model.yMax);
    return drawn ? [{ rate, rank, values }] : [];
  });
}

/** 0.22 → "22%". Federal rates are whole percents. */
export function bracketRateLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
