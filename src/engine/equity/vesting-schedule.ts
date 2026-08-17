import type { StockOptionPlan, EquityGrant, GrantType } from "./types";
import { projectFmv, resolveStrikePrice } from "./price-model";
import { isQualifyingIsoDisposition } from "./holding-period";
import { buildGrantTimeline, type EquityAction } from "./timeline";
import { resolveStrategy } from "./strategy";
import { endOfYear, yearOf } from "./dates";

export interface IsoSplit {
  qualified: number; // exercised ISO shares past the holding period (LTCG-eligible)
  holding: number;   // exercised ISO shares still in the holding window
}

export interface VestingScheduleRow {
  grantId: string;
  label: string;
  grantType: GrantType;
  isOption: boolean;                 // grantType !== "rsu"
  /** Per-share strike the plan will actually charge (options only). See
   *  `plannedStrikes` — the lowest, when the plan charges more than one. */
  strike: number | null;
  /** The highest strike, set ONLY when a discount-priced grant resolves to more
   *  than one — the column then reads as a range. Null for every ordinary
   *  grant, which has a single strike written on it. */
  strikeHigh: number | null;
  expirationYear: number | null;     // options only
  granted: number;
  vested: number;                    // vestYear < asOfYear (or whole grant if 83(b))
  exercisable: number | null;        // options: max(0, vested - exercised); RSU: null
  exercised: number | null;          // options: Σ sharesExercised; RSU: null
  isoSplit: IsoSplit | null;         // ISO with exercised > 0
  /** True when this grant holds shares acquired BEFORE the plan began whose
   *  acquisition date or price the advisor has not entered, so at least one
   *  figure on this row comes from the conservative fallback rather than a
   *  recorded fact. The screen says so — an unlabelled guess is the defect G8
   *  removes, not the fallback itself. */
  hasEstimatedAcquisition: boolean;
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
      const vestYear = yearOf(t.vestDate);
      if (vestYear < asOfYear) {
        vested += t.shares;
        continue;
      }
      const val = t.shares * perShareValue(vestYear);
      if (vestYear <= lastDiscrete) {
        const idx = vestYear - asOfYear;
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
  // One timeline, two questions. Both the Strike column and the estimated-
  // acquisition marker have to agree with what the tax ledger actually does,
  // and the only way to guarantee that is to ask the same function it runs.
  const fmvAt = (year: number) => projectFmv(plan.pricePerShare, plan.growthRate, year, planStartYear);
  const acct = resolveStrategy(plan.strategy, null, null); // exactly what createEquityState does
  const actions = buildGrantTimeline(grant, acct, planStartYear, fmvAt);
  const strikes = isOption ? plannedStrikes(grant, actions, fmvAt, planStartYear) : [];

  return {
    grantId: grant.id,
    label: grant.grantNumber ?? `${plan.ticker ?? "—"} ${yearOf(grant.grantDate)}`,
    grantType: grant.grantType,
    isOption,
    strike: isOption ? strikes[0] : null,
    strikeHigh: isOption && strikes.length > 1 ? strikes[strikes.length - 1] : null,
    expirationYear: grant.expirationYear ?? null,
    granted: grant.sharesGranted,
    vested,
    exercisable: isOption ? Math.max(0, vested - exercisedTotal) : null,
    exercised: isOption ? exercisedTotal : null,
    isoSplit: isoSplitFor(grant, asOfYear),
    hasEstimatedAcquisition: hasEstimatedAcquisition(actions),
    sold: soldTotal,
    futureByYear,
    futurePlus,
    unvested: grant.sharesGranted - vested,
    estValueByYear,
    estValuePlus,
  };
}

/** The strike(s) the plan will actually charge for this option grant, ascending
 *  and de-duplicated.
 *
 *  A grant with a strike written on it has one, and this is a formality. A
 *  grant priced by DISCOUNT has none until an exercise year is known —
 *  `resolveStrikePrice` reads the discount off the FMV *in the exercise year*
 *  (schema.ts: "a % off FMV in the exercise year") — so the honest answer is
 *  whatever the engine is about to charge. We ask the engine: `buildGrantTimeline`
 *  is the same function the tax ledger runs, so the Strike column and the
 *  ledger's Ex. Price cannot disagree. They used to differ by $17 on the same
 *  grant, because this column resolved the discount against the plan-start
 *  price. Audit F36.
 *
 *  A grant the plan never exercises (out of the money, lapsed, or vesting past
 *  expiry) has no exercise year at all. There is no ledger row to contradict,
 *  so it falls back to the plan-start resolution rather than showing nothing. */
function plannedStrikes(
  grant: EquityGrant,
  actions: EquityAction[],
  fmvAt: (year: number) => number,
  planStartYear: number,
): number[] {
  const found = new Set<number>();
  for (const a of actions) {
    if (a.kind === "exercise") found.add(resolveStrikePrice(grant, fmvAt(a.year)));
  }
  if (found.size === 0) return [resolveStrikePrice(grant, fmvAt(planStartYear))];
  return [...found].sort((a, b) => a - b);
}

/** Does any figure on this grant rest on the blank-acquisition fallback?
 *
 *  `timeline.ts` falls back to the plan start date at no price — held zero days,
 *  basis floored — for shares acquired before the plan whose facts the advisor
 *  has not entered. That answer is deliberately conservative and correct; saying
 *  nothing about it is what misleads, because a guess printed plainly reads
 *  exactly like a recorded fact.
 *
 *  We ask the engine rather than restating its rule. `seed_held` is the ONLY
 *  action the fallback touches, and the timeline already publishes the answer on
 *  the action: `priceAtAcquisition` is set to `acquiredOn ? priceAtAcquisition
 *  : null`, so a null there IS "the advisor left this blank". Re-deriving the
 *  three seeding conditions here instead — pre-plan RSU rows, already-exercised
 *  option rows, and the whole-grant 83(b) seed — is what let the Strike column
 *  drift $17 from the ledger before F36. A row vesting in the future is acquired
 *  on its vest date by `acquire_rsu`, emits no seed, and so is never marked.
 *  Audit F1/F2. */
function hasEstimatedAcquisition(actions: EquityAction[]): boolean {
  return actions.some((a) => a.kind === "seed_held" && a.priceAtAcquisition == null);
}

/** ISO qualified/holding split for shares the client has ALREADY exercised.
 *
 *  Answers exactly the question the tax ledger answers when those shares are
 *  sold — the same `isQualifyingIsoDisposition`, the same stored exercise date,
 *  and 31 December of the as-of year for the sale, which is the day the ledger
 *  dates a modeled sale on. So the badge cannot promise a treatment the plan
 *  will not give. Audit F17/F47.
 *
 *  Per ROW, not per grant: two rows of one grant exercised eighteen months
 *  apart are genuinely in different buckets. Before G8 the exercise date was an
 *  assumption shared by every row, so the whole loop was invariant and one
 *  bucket was always zero. */
function isoSplitFor(grant: EquityGrant, asOfYear: number): IsoSplit | null {
  if (grant.grantType !== "iso") return null;
  let qualified = 0;
  let holding = 0;
  for (const t of grant.tranches) {
    if (t.sharesExercised <= 0) continue;
    // No stored exercise date ⇒ the exercise leg cannot be shown to be clear.
    // Conservative: it counts as still holding. Never assume a date.
    const isQualified =
      t.acquiredOn != null &&
      isQualifyingIsoDisposition({
        grantDate: grant.grantDate,
        exerciseDate: t.acquiredOn,
        dispositionDate: endOfYear(asOfYear),
      });
    if (isQualified) qualified += t.sharesExercised;
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
