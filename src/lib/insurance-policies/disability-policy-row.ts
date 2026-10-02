import type { DisabilityPolicy } from "@/engine/types";

/**
 * Engine `DisabilityPolicy` → `disability_policies` columns: the inverse of
 * `rowToDisabilityPolicy`. Promotion needs it because a scenario stores the
 * engine shape (`shortTerm` / `longTerm` objects, a `benefitPeriod` union) while
 * the row is flat `has*`, `std*` and `ltd*` columns, and `coerceForTable` keeps only
 * exact column names.
 *
 * Every other key passes through unchanged. That carries the flat fields (whose
 * names already match their columns) and the display-only `carrier` / `notes`
 * the engine type lacks but the row stores; `coerceForTable` drops anything
 * that is not a column.
 */
export function disabilityPolicyToRow(p: DisabilityPolicy): Record<string, unknown> {
  return disabilitySetToColumns(p);
}

/**
 * The partial-safe form, for an edit's `set`: a layer key that is absent emits
 * nothing, so an UPDATE leaves that layer's columns alone. A null layer emits
 * only its `has*` flag — the layer's detail columns keep their stored values, which
 * `rowToDisabilityPolicy` ignores while the flag is false.
 */
export function disabilitySetToColumns(
  set: Partial<DisabilityPolicy>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(set)) {
    if (key === "shortTerm") Object.assign(out, shortTermColumns(set.shortTerm ?? null));
    else if (key === "longTerm") Object.assign(out, longTermColumns(set.longTerm ?? null));
    else out[key] = value;
  }
  return out;
}

function shortTermColumns(st: DisabilityPolicy["shortTerm"]): Record<string, unknown> {
  if (!st) return { hasShortTerm: false };
  return {
    hasShortTerm: true,
    stdEliminationDays: st.eliminationDays,
    stdBenefitPct: st.benefitPct,
    stdDurationWeeks: st.durationWeeks,
    stdMonthlyMax: st.monthlyMax,
  };
}

function longTermColumns(lt: DisabilityPolicy["longTerm"]): Record<string, unknown> {
  if (!lt) return { hasLongTerm: false };
  const bp = lt.benefitPeriod;
  return {
    hasLongTerm: true,
    ltdEliminationDays: lt.eliminationDays,
    ltdBenefitPct: lt.benefitPct,
    ltdMonthlyMax: lt.monthlyMax,
    ltdBenefitPeriodMode: bp.mode,
    // Both detail columns are written every time, so switching modes clears
    // the one the new mode does not use.
    ltdBenefitPeriodAge: bp.mode === "to_age" ? bp.age : null,
    ltdBenefitPeriodYears: bp.mode === "years" ? bp.years : null,
  };
}
