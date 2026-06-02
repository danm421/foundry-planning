// src/lib/presentations/pages/life-insurance-summary/aggregate.ts
import type { LiPolicyRow } from "@/lib/insurance-policies/load-li-inventory";

// ── Formatting (single source; page-pdf + chart import these) ────────────────
export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ── Inventory totals ─────────────────────────────────────────────────────────
export interface InventoryTotals {
  count: number;
  deathBenefit: number;
  cashValue: number;
  premium: number;
}
export function inventoryTotals(rows: LiPolicyRow[]): InventoryTotals {
  return rows.reduce<InventoryTotals>(
    (t, r) => ({
      count: t.count + 1,
      deathBenefit: t.deathBenefit + r.deathBenefit,
      cashValue: t.cashValue + r.cashValue,
      premium: t.premium + r.premiumAmount,
    }),
    { count: 0, deathBenefit: 0, cashValue: 0, premium: 0 },
  );
}

// ── Per-decedent current coverage (joint excluded — see spec) ────────────────
export interface DecedentCoverage {
  total: number;
  /** True when a joint-life policy exists; surfaced as a footnote because the
   *  data model can't distinguish first-to-die from survivorship. */
  hasJoint: boolean;
}
export function coverageForDecedent(
  rows: LiPolicyRow[],
  decedent: "client" | "spouse",
): DecedentCoverage {
  let total = 0;
  let hasJoint = false;
  for (const r of rows) {
    if (r.insuredPerson === "joint") hasJoint = true;
    else if (r.insuredPerson === decedent) total += r.deathBenefit;
  }
  return { total, hasJoint };
}

// ── Gap ──────────────────────────────────────────────────────────────────────
export interface Gap {
  kind: "shortfall" | "surplus" | "met";
  amount: number;
}
export function gapFor(have: number, need: number): Gap {
  if (need > have) return { kind: "shortfall", amount: need - have };
  if (have > need) return { kind: "surplus", amount: have - need };
  return { kind: "met", amount: 0 };
}

// ── Term expiry ────────────────────────────────────────────────────────────--
export function termExpiryLabel(row: LiPolicyRow): string {
  if (row.policyType === "term" && row.termExpiryYear != null) {
    return String(row.termExpiryYear);
  }
  return "—";
}

export const POLICY_TYPE_LABEL: Record<LiPolicyRow["policyType"], string> = {
  term: "Term",
  whole: "Whole life",
  universal: "Universal",
  variable: "Variable",
};
