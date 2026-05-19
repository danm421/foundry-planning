import type { ClientData } from "@/engine/types";
import {
  solveLifeInsuranceNeed,
  type LifeInsuranceAssumptions,
  type NeedResult,
} from "./solve-need";

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

function isMarried(data: ClientData): boolean {
  const status = data.client.filingStatus;
  return status === "married_joint" || status === "married_separate";
}

/**
 * Compute the deterministic (straight-line) life-insurance need for every plan
 * year. For each year from `planStartYear` to `planEndYear`, `solveLifeInsuranceNeed`
 * is run for the client-death case and — when the client is married — the
 * spouse-death case, using that year as `deathYear`.
 *
 * `onProgress` is invoked once per year with the cumulative count of years
 * solved and the total number of years, so a caller (e.g. an SSE route) can
 * stream progress to the UI.
 */
export function computeNeedOverTime(
  data: ClientData,
  assumptions: Omit<LifeInsuranceAssumptions, "deathYear">,
  onProgress?: NeedOverTimeProgress,
): NeedOverTimeRow[] {
  const { planStartYear, planEndYear } = data.planSettings;
  const married = isMarried(data);
  const rows: NeedOverTimeRow[] = [];
  const total = planEndYear - planStartYear + 1;

  for (let year = planStartYear; year <= planEndYear; year++) {
    const yearAssumptions: LifeInsuranceAssumptions = {
      ...assumptions,
      deathYear: year,
    };

    const clientResult = solveLifeInsuranceNeed(data, "client", yearAssumptions);
    const spouseResult = married
      ? solveLifeInsuranceNeed(data, "spouse", yearAssumptions)
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
