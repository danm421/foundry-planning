import type { ClientData } from "@/engine/types";
import {
  runLifeInsuranceWhatIf,
  survivorEndingPortfolio,
} from "@/engine/what-if/life-insurance-need";
import {
  solveLifeInsuranceNeed,
  type LifeInsuranceAssumptions,
  type NeedResult,
} from "./solve-need";
import { estateTaxAddendFromProjection } from "./estate-tax-addend";

/**
 * One straight-line life-insurance need value per plan year, per decedent.
 *
 * `spouseNeed` / `spouseStatus` are `null` when the client is not married.
 */
export interface NeedOverTimeRow {
  year: number;
  clientNeed: number;
  spouseNeed: number | null;
  clientStatus: NeedResult["status"];
  spouseStatus: NeedResult["status"] | null;
}

/** Progress callback fired once per year after that year's solve(s) complete. */
export type NeedOverTimeProgress = (done: number, total: number) => void;

/**
 * Whether the spouse-death solve can run for this client.
 *
 * The engine's `runLifeInsuranceWhatIf` throws when `deceased === "spouse"` and
 * `spouseDob` is absent, so a married `filingStatus` alone is not enough — the
 * solve also requires `spouseDob`. `spouseDob` presence is the spouse-existence
 * signal used elsewhere in the life-insurance code.
 */
export function hasSpouse(data: ClientData): boolean {
  const status = data.client.filingStatus;
  const married = status === "married_joint" || status === "married_separate";
  return married && Boolean(data.client.spouseDob);
}

/**
 * Solve one decedent's straight-line need. One face-value-0 what-if projection
 * powers BOTH the estate-tax addend (when enabled) AND the solver's `atZero`
 * anchor, so the zero probe is never run twice. `seedFace` warm-starts the
 * solver's reference probe from the previous year's answer.
 *
 * Mirrors `solveCase` in the /life-insurance/solve route so the over-time
 * curve and the single-point solve agree at any given death year. The addend
 * depends on `a.deathYear` (later deaths grow the estate), so it is
 * recomputed per year per decedent.
 */
function solveNeedFused(
  data: ClientData,
  deceased: "client" | "spouse",
  a: LifeInsuranceAssumptions,
  coverEstateTaxes: boolean,
  seedFace: number | undefined,
): NeedResult {
  const proj0 = runLifeInsuranceWhatIf({
    data,
    deceased,
    deathYear: a.deathYear,
    faceValue: 0,
    proceedsGrowthRate: a.proceedsGrowthRate,
    proceedsRealization: a.proceedsRealization,
    livingExpenseAtDeath: a.livingExpenseAtDeath,
    payoffLiabilityIds: a.payoffLiabilityIds,
  });
  const atZero = survivorEndingPortfolio(proj0, deceased, data);
  const estateTaxAddend = coverEstateTaxes ? estateTaxAddendFromProjection(proj0) : 0;
  const augmented: LifeInsuranceAssumptions = {
    ...a,
    leaveToHeirsAmount: a.leaveToHeirsAmount + estateTaxAddend,
  };
  return solveLifeInsuranceNeed(data, deceased, augmented, { atZero, seedFace });
}

/**
 * Compute the deterministic (straight-line) life-insurance need for every plan
 * year. For each year from `planStartYear` to `planEndYear`, `solveLifeInsuranceNeed`
 * is run for the client-death case and — when the client is married — the
 * spouse-death case, using that year as `deathYear`.
 *
 * When `coverEstateTaxes` is on, each year/decedent's target gains that death
 * year's estate-tax addend (federal + state estate tax + IRD income tax) before
 * the solve — matching the single-point /solve route, so a curve row and the
 * point solve at the same death year land on the same face value.
 *
 * `onProgress` is invoked once per year with the cumulative count of years
 * solved and the total number of years, so a caller (e.g. an SSE route) can
 * stream progress to the UI.
 */
export function computeNeedOverTime(
  data: ClientData,
  assumptions: Omit<LifeInsuranceAssumptions, "deathYear">,
  coverEstateTaxes: boolean,
  onProgress?: NeedOverTimeProgress,
): NeedOverTimeRow[] {
  const { planStartYear, planEndYear } = data.planSettings;
  const married = hasSpouse(data);
  const rows: NeedOverTimeRow[] = [];
  const total = planEndYear - planStartYear + 1;

  for (let year = planStartYear; year <= planEndYear; year++) {
    const yearAssumptions: LifeInsuranceAssumptions = {
      ...assumptions,
      deathYear: year,
    };

    const clientResult = solveNeedFused(data, "client", yearAssumptions, coverEstateTaxes, undefined);
    const spouseResult = married
      ? solveNeedFused(data, "spouse", yearAssumptions, coverEstateTaxes, undefined)
      : null;

    rows.push({
      year,
      clientNeed: clientResult.faceValue,
      spouseNeed: spouseResult ? spouseResult.faceValue : null,
      clientStatus: clientResult.status,
      spouseStatus: spouseResult ? spouseResult.status : null,
    });

    onProgress?.(rows.length, total);
  }

  return rows;
}
