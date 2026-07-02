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

/** Whether a policy still pays out in `year`. Permanent policies always do; a
 *  term policy is in force through its expiry year inclusive — mirroring the
 *  engine, which drops a term policy only once `year > endYear`
 *  (projection.ts term-retirement filter). A term row with no known expiry is
 *  treated as in force. Comparing coverage against the solved need REQUIRES this
 *  filter: the engine excludes expired term from the need, so summing expired
 *  term into `have` inverts the presented shortfall. */
export function isInForce(row: LiPolicyRow, year: number): boolean {
  if (row.policyType !== "term") return true;
  if (row.termExpiryYear == null) return true;
  return year <= row.termExpiryYear;
}

// ── Per-decedent current coverage (joint excluded — see spec) ────────────────
export interface DecedentCoverage {
  total: number;
  /** True when an in-force joint-life policy exists; surfaced as a footnote
   *  because the data model can't distinguish first-to-die from survivorship. */
  hasJoint: boolean;
}
export function coverageForDecedent(
  rows: LiPolicyRow[],
  decedent: "client" | "spouse",
  asOfYear: number,
): DecedentCoverage {
  let total = 0;
  let hasJoint = false;
  for (const r of rows) {
    if (!isInForce(r, asOfYear)) continue; // expired term pays nothing at death
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
