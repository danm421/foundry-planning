// Per-year surplus spend rate.
//
// `surplusSpendPct` is a flat assumption applied to every projection year.
// `surplusSpendAllUntilRetirement` overrides it to 100% for every year strictly
// before the household's FIRST retirement year, modeling the common advisor
// assumption that working-years surplus is absorbed by lifestyle rather than
// quietly compounding into the portfolio. From the retirement year onward the
// stored percentage applies unchanged.

import { firstRetirementYear } from "./retirement-proration";
import type { ClientInfo, PlanSettings } from "./types";

export function effectiveSurplusSpendPct(
  planSettings: PlanSettings,
  client: ClientInfo,
  year: number,
): number {
  const stored = Math.min(1, Math.max(0, planSettings.surplusSpendPct ?? 0));
  if (!planSettings.surplusSpendAllUntilRetirement) return stored;
  const retYear = firstRetirementYear(client);
  // Nothing to anchor to (no parseable DOB) — never silently force 100%.
  if (retYear == null) return stored;
  return year < retYear ? 1 : stored;
}
