import type { StateEstateTaxRule } from "./types";

export interface CapApplication {
  cap: number;
  applied: boolean;
  reduction: number;
  finalTax: number;
}

/** CT: cap the combined estate+gift tax at rule.capCombined. */
export function applyMaxCombinedCap(rule: StateEstateTaxRule, preCapTax: number): CapApplication {
  if (rule.capCombined == null) {
    return { cap: 0, applied: false, reduction: 0, finalTax: preCapTax };
  }
  const cap = rule.capCombined;
  if (preCapTax <= cap) {
    return { cap, applied: false, reduction: 0, finalTax: preCapTax };
  }
  return { cap, applied: true, reduction: preCapTax - cap, finalTax: cap };
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
