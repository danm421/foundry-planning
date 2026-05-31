import type { StateEstateTaxRule } from "./types";

export interface CapApplication {
  cap: number;
  applied: boolean;
  reduction: number;
  finalTax: number;
}

/**
 * CT §12-391(g): cap the COMBINED lifetime CT gift tax + estate tax at rule.capCombined.
 * `priorGiftTax` is the cumulative CT gift tax already paid on lifetime gifts; when the
 * combined total exceeds the cap, the overage reduces the estate tax (floored at $0).
 * Defaults to 0 so existing two-arg callers are unchanged (estate-tax-only behavior).
 */
export function applyMaxCombinedCap(
  rule: StateEstateTaxRule,
  preCapTax: number,
  priorGiftTax = 0,
): CapApplication {
  if (rule.capCombined == null) {
    return { cap: 0, applied: false, reduction: 0, finalTax: preCapTax };
  }
  const cap = rule.capCombined;
  const combined = preCapTax + priorGiftTax;
  if (combined <= cap) {
    return { cap, applied: false, reduction: 0, finalTax: preCapTax };
  }
  const reduction = combined - cap;
  return { cap, applied: true, reduction, finalTax: Math.max(0, preCapTax - reduction) };
}

export interface CliffApplication {
  threshold: number;
  applied: boolean;
}

/** NY: when taxableEstate exceeds cliffPct × exemption, the entire estate is taxable (no credit). */
export function applyCliff(rule: StateEstateTaxRule, baseForTax: number): CliffApplication {
  if (rule.cliffPct == null) return { threshold: 0, applied: false };
  const threshold = rule.exemption * rule.cliffPct;
  return { threshold, applied: baseForTax > threshold };
}
