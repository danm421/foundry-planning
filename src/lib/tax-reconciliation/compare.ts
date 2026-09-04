import { boundedLevenshtein } from "@/lib/imports/levenshtein";
import { fmtUsd } from "@/lib/tax-analysis/format";
import type { FindingLineRef } from "@/lib/tax-analysis/types";
import type { Delta, PlanSnapshot, ReconciliationInput } from "./types";

export interface Tolerance { pct: number; abs: number }
export const ROW: Tolerance = { pct: 0.05, abs: 500 };
export const W2: Tolerance = { pct: 0.10, abs: 500 };
export const SPEND: Tolerance = { pct: 0.10, abs: 10_000 };

/** Whether the card may offer an amount box for this figure, for the arms that can
 *  compute a NEGATIVE one — a business that lost money, a rental netting below its
 *  depreciation, a negative-AGI MAGI.
 *
 *  It may not. The box is unsigned (it strips everything but digits and a dot) and
 *  `apply.ts` rejects `amount < 0` outright, so an editable negative initialises to
 *  its own magnitude and is applied as the POSITIVE twin — +$5,000 written where the
 *  rule computed -$5,000, with no user action at all. Left un-editable the client
 *  sends no amount, and the target's own patch carries the sign through unchanged.
 *  The figure stays on the card either way; the row itself is still editable on the
 *  screen the card links to. */
export const editableAmount = (v: number): boolean => v >= 0;

export const n = (v: number | null | undefined): number => v ?? 0;
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
export const money = (v: number | null): string => (v == null ? "—" : fmtUsd(v));
export const ref = (form: string, line: string, label: string, amount: number | null): FindingLineRef => ({ form, line, label, amount });

const SUFFIXES = new Set(["llc", "inc", "corp", "corporation", "co", "ltd", "lp", "llp", "pc", "pllc", "the"]);

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w && !SUFFIXES.has(w)).join(" ");
}

/** Equal · one contains the other (shorter ≥ 4) · both ≥ 6 and ≤ 2 edits apart. */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && long.includes(short)) return true;
  return x.length >= 6 && y.length >= 6 && boundedLevenshtein(x, y, 2) !== -1;
}

/** Gap must exceed BOTH the percent (of the return figure; of the plan figure
 *  when the return is 0) and the dollar floor. Null return → never differs. */
export function differs(returnAmt: number | null, planAmt: number | null, t: Tolerance): boolean {
  if (returnAmt == null) return false;
  const p = n(planAmt);
  const gap = Math.abs(returnAmt - p);
  const base = Math.abs(returnAmt) > 0 ? Math.abs(returnAmt) : Math.abs(p);
  return gap > t.abs && gap > t.pct * base;
}

export function deflate(amount: number, rate: number, years: number): number {
  return years <= 0 ? amount : amount / Math.pow(1 + rate, years);
}

/** Mirrors the engine's GROWTH branch (src/engine/income.ts): compound from
 *  inflationStartYear when set, else from startYear. Valid for years before
 *  the start too — that is exactly the "state it in taxYear dollars" case.
 *
 *  Two engine paths never reach that formula, so this is not the whole rule:
 *  a row carrying year-by-year `scheduleOverrides` reads its amount straight
 *  out of the schedule, and a Social Security row in `pia_at_fra` mode is
 *  resolved by the benefit orchestrator instead. Callers comparing those rows
 *  against a return get the growth-branch figure, not the engine's. */
export function rowAmountInYear(
  row: { annualAmount: number; growthRate: number; startYear: number; inflationStartYear: number | null },
  year: number,
): number {
  const from = row.inflationStartYear ?? row.startYear;
  return row.annualAmount * Math.pow(1 + row.growthRate, year - from);
}

export const isActiveInYear = (row: { startYear: number; endYear: number }, year: number): boolean =>
  row.startYear <= year && year <= row.endYear;

export function ageAtYearEnd(dob: string | null, year: number): number | null {
  if (!dob) return null;
  const birthYear = Number(dob.slice(0, 4));
  return Number.isFinite(birthYear) ? year - birthYear : null;
}

export function makeDelta(returnAmt: number | null, planAmt: number | null): Delta {
  if (returnAmt == null && planAmt == null) return { amount: null, display: "—", tone: "neutral" };
  const r = n(returnAmt), p = n(planAmt);
  const gap = p - r;
  if (r > 0 && p === 0) return { amount: gap, display: "Not in the plan", tone: "missing" };
  if (p > 0 && r === 0) return { amount: gap, display: "Not on the return", tone: "extra" };
  if (gap < 0) return { amount: gap, display: `Plan is ${fmtUsd(-gap)} short`, tone: "short" };
  if (gap > 0) return { amount: gap, display: `Plan is ${fmtUsd(gap)} over`, tone: "over" };
  return { amount: 0, display: "In line", tone: "neutral" };
}

export const hasSpouse = (plan: PlanSnapshot): boolean =>
  plan.client.spouseDob != null || plan.familyMembers.some((m) => m.role === "spouse");

export const detailsHref = (input: ReconciliationInput, slug: string): string =>
  `/clients/${input.clientId}/details/${slug}`;

/** Engine-level figures are stated in planYear dollars; bring them back to taxYear. */
export const planToTaxYear = (input: ReconciliationInput, amount: number): number =>
  deflate(amount, input.plan.planSettings.inflationRate, input.planYear - input.taxYear);
