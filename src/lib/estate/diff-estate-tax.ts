// Comparison math for the Estate Tax and State Death Tax reports.
//
// Every delta is `right - left`. A plan that cuts the tax bill therefore
// produces a NEGATIVE delta; deciding whether negative is good news is the
// renderer's job, not this module's.
import type { EstateTaxResult, GrossEstateLine } from "@/engine/types";
import type { StateEstateTaxResult } from "@/lib/tax/state-estate/types";

export type LineStatus = "same" | "changed" | "added" | "removed";

export interface LineDiff {
  key: string;
  status: LineStatus;
  delta: number;
}

export interface EstateTaxTotalsDiff {
  grossEstate: number;
  taxableEstate: number;
  tentativeTaxBase: number;
  federalEstateTax: number;
  stateEstateTax: number;
  totalTaxesAndExpenses: number;
}

export interface EstateTaxDiff {
  totals: EstateTaxTotalsDiff;
  /** Union of both sides' line keys. */
  lines: Map<string, LineDiff>;
}

/**
 * Stable per-line identity. `GrossEstateLine` allows all three ids to be null
 * (a flat entity valuation, say), and two such lines can share a label, so an
 * occurrence counter is appended to every key. Without it, two "Home" lines
 * would collapse into one and the diff would silently compare the wrong rows.
 */
export function grossEstateLineKeys(lines: GrossEstateLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base =
      l.accountId ?? l.liabilityId ?? l.entityId ?? `label:${l.label}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  });
}

function amountsByKey(lines: GrossEstateLine[]): Map<string, number> {
  const keys = grossEstateLineKeys(lines);
  const out = new Map<string, number>();
  keys.forEach((k, i) => out.set(k, lines[i].amount));
  return out;
}

export function diffEstateTax(
  left: EstateTaxResult,
  right: EstateTaxResult,
): EstateTaxDiff {
  const l = amountsByKey(left.grossEstateLines);
  const r = amountsByKey(right.grossEstateLines);

  const lines = new Map<string, LineDiff>();
  for (const key of new Set([...l.keys(), ...r.keys()])) {
    const lv = l.get(key);
    const rv = r.get(key);
    if (lv === undefined) {
      lines.set(key, { key, status: "added", delta: rv ?? 0 });
    } else if (rv === undefined) {
      lines.set(key, { key, status: "removed", delta: -lv });
    } else {
      const delta = rv - lv;
      lines.set(key, { key, status: delta === 0 ? "same" : "changed", delta });
    }
  }

  return {
    totals: {
      grossEstate: right.grossEstate - left.grossEstate,
      taxableEstate: right.taxableEstate - left.taxableEstate,
      tentativeTaxBase: right.tentativeTaxBase - left.tentativeTaxBase,
      federalEstateTax: right.federalEstateTax - left.federalEstateTax,
      stateEstateTax: right.stateEstateTax - left.stateEstateTax,
      totalTaxesAndExpenses:
        right.totalTaxesAndExpenses - left.totalTaxesAndExpenses,
    },
    lines,
  };
}

export function diffStateEstateTax(
  left: StateEstateTaxResult,
  right: StateEstateTaxResult,
): {
  exemption: number;
  baseForTax: number;
  amountOverExemption: number;
  stateEstateTax: number;
} {
  return {
    exemption: right.exemption - left.exemption,
    baseForTax: right.baseForTax - left.baseForTax,
    amountOverExemption: right.amountOverExemption - left.amountOverExemption,
    stateEstateTax: right.stateEstateTax - left.stateEstateTax,
  };
}
