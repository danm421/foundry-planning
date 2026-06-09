import type { StockOptionPlan, EquityGrant, GrantType } from "./types";
import { projectFmv, resolveStrikePrice } from "./price-model";

export interface IsoSplit {
  qualified: number; // exercised ISO shares past the holding period (LTCG-eligible)
  holding: number;   // exercised ISO shares still in the holding window
}

export interface VestingScheduleRow {
  grantId: string;
  label: string;
  grantType: GrantType;
  isOption: boolean;                 // grantType !== "rsu"
  strike: number | null;             // per-share strike (options only)
  expirationYear: number | null;     // options only
  granted: number;
  vested: number;                    // vestYear < asOfYear (or whole grant if 83(b))
  exercisable: number | null;        // options: max(0, vested - exercised); RSU: null
  exercised: number | null;          // options: Σ sharesExercised; RSU: null
  isoSplit: IsoSplit | null;         // ISO with exercised > 0
  sold: number;                      // Σ sharesSold (actual, to date)
  futureByYear: number[];            // aligned to model.yearColumns
  futurePlus: number;                // shares vesting beyond the last discrete column
  unvested: number;                  // granted - vested
  estValueByYear: number[];          // value vesting each discrete column
  estValuePlus: number;              // value vesting in the plus bucket
}

export interface VestingScheduleTotals {
  granted: number; vested: number; exercisable: number; exercised: number; sold: number;
  futureByYear: number[]; futurePlus: number; unvested: number;
  estValueByYear: number[]; estValuePlus: number;
}

export interface VestingScheduleModel {
  asOfYear: number;
  yearColumns: number[];             // discrete future-year columns
  plusLabel: string | null;          // e.g. "2030+" or null if nothing overflows
  rows: VestingScheduleRow[];
  totals: VestingScheduleTotals;
}

export interface BuildVestingScheduleOptions {
  asOfYear: number;                  // vesting boundary: vestYear < asOfYear counts as vested
  planStartYear: number;             // FMV projection base year
  futureYearCount?: number;          // discrete columns before the "+" bucket; default 4
}

export function buildVestingSchedule(
  plans: StockOptionPlan[],
  opts: BuildVestingScheduleOptions,
): VestingScheduleModel {
  const { asOfYear, planStartYear } = opts;
  const futureYearCount = opts.futureYearCount ?? 4;

  const yearColumns: number[] = [];
  for (let i = 0; i < futureYearCount; i++) yearColumns.push(asOfYear + i);
  const lastDiscrete = yearColumns[yearColumns.length - 1];

  const rows: VestingScheduleRow[] = [];
  for (const plan of plans) {
    for (const grant of plan.grants) {
      rows.push(buildRow(plan, grant, { asOfYear, planStartYear, yearColumns, lastDiscrete }));
    }
  }

  const hasPlus = rows.some((r) => r.futurePlus > 0);
  const plusLabel = hasPlus ? `${lastDiscrete + 1}+` : null;

  return { asOfYear, yearColumns, plusLabel, rows, totals: sumTotals(rows, yearColumns.length) };
}

interface RowCtx {
  asOfYear: number;
  planStartYear: number;
  yearColumns: number[];
  lastDiscrete: number;
}

function buildRow(plan: StockOptionPlan, grant: EquityGrant, ctx: RowCtx): VestingScheduleRow {
  const { asOfYear, planStartYear, yearColumns, lastDiscrete } = ctx;
  const isOption = grant.grantType !== "rsu";

  // Per-share economic value for a given year: RSU = FMV; option = intrinsic (max(0, FMV - strike)).
  const perShareValue = (year: number): number => {
    const fmv = projectFmv(plan.pricePerShare, plan.growthRate, year, planStartYear);
    if (isOption) return Math.max(0, fmv - resolveStrikePrice(grant, fmv));
    return fmv;
  };

  const futureByYear = yearColumns.map(() => 0);
  const estValueByYear = yearColumns.map(() => 0);
  let futurePlus = 0;
  let estValuePlus = 0;
  let vested = 0;

  if (grant.has83bElection) {
    // 83(b): the whole grant is acquired (and taxed) at grant — treat as fully vested.
    vested = grant.sharesGranted;
  } else {
    for (const t of grant.tranches) {
      if (t.vestYear < asOfYear) {
        vested += t.shares;
        continue;
      }
      const val = t.shares * perShareValue(t.vestYear);
      if (t.vestYear <= lastDiscrete) {
        const idx = t.vestYear - asOfYear;
        futureByYear[idx] += t.shares;
        estValueByYear[idx] += val;
      } else {
        futurePlus += t.shares;
        estValuePlus += val;
      }
    }
  }

  const exercisedTotal = grant.tranches.reduce((s, t) => s + t.sharesExercised, 0);
  const soldTotal = grant.tranches.reduce((s, t) => s + t.sharesSold, 0);

  return {
    grantId: grant.id,
    label: grant.grantNumber ?? `${plan.ticker ?? "—"} ${grant.grantYear}`,
    grantType: grant.grantType,
    isOption,
    strike: isOption ? resolveStrikePrice(grant, projectFmv(plan.pricePerShare, plan.growthRate, planStartYear, planStartYear)) : null,
    expirationYear: grant.expirationYear ?? null,
    granted: grant.sharesGranted,
    vested,
    exercisable: isOption ? Math.max(0, vested - exercisedTotal) : null,
    exercised: isOption ? exercisedTotal : null,
    isoSplit: isoSplitFor(grant, asOfYear),
    sold: soldTotal,
    futureByYear,
    futurePlus,
    unvested: grant.sharesGranted - vested,
    estValueByYear,
    estValuePlus,
  };
}

/** ISO qualified/holding split for exercised shares.
 *  Qualifying disposition needs held ≥2y from grant AND ≥1y from exercise.
 *  We lack actual exercise dates (tranches store counts only), so we assume
 *  exercise happened at the tranche vest year → qualifyYear = max(grantYear+2, vestYear+1).
 *  An exercised tranche's shares are "qualified" once asOfYear ≥ qualifyYear. */
function isoSplitFor(grant: EquityGrant, asOfYear: number): IsoSplit | null {
  if (grant.grantType !== "iso") return null;
  let qualified = 0;
  let holding = 0;
  for (const t of grant.tranches) {
    if (t.sharesExercised <= 0) continue;
    const qualifyYear = Math.max(grant.grantYear + 2, t.vestYear + 1);
    if (asOfYear >= qualifyYear) qualified += t.sharesExercised;
    else holding += t.sharesExercised;
  }
  if (qualified + holding === 0) return null;
  return { qualified, holding };
}

function sumTotals(rows: VestingScheduleRow[], n: number): VestingScheduleTotals {
  const t: VestingScheduleTotals = {
    granted: 0, vested: 0, exercisable: 0, exercised: 0, sold: 0,
    futureByYear: Array(n).fill(0), futurePlus: 0, unvested: 0,
    estValueByYear: Array(n).fill(0), estValuePlus: 0,
  };
  for (const r of rows) {
    t.granted += r.granted;
    t.vested += r.vested;
    t.exercisable += r.exercisable ?? 0;
    t.exercised += r.exercised ?? 0;
    t.sold += r.sold;
    t.unvested += r.unvested;
    t.futurePlus += r.futurePlus;
    t.estValuePlus += r.estValuePlus;
    for (let i = 0; i < n; i++) {
      t.futureByYear[i] += r.futureByYear[i];
      t.estValueByYear[i] += r.estValueByYear[i];
    }
  }
  return t;
}
