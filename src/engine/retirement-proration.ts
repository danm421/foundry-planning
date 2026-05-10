// Retirement-month proration. When a client retires mid-year, items linked to
// the retirement transition (Income/Expense/SavingsRule with
// startYearRef/endYearRef = "client_retirement" or "spouse_retirement") run
// only for part of the retirement year:
//
//   - End-at-retirement items: Jan..(retMonth-1)  →  fraction = (retMonth-1)/12
//   - Start-at-retirement items: retMonth..Dec    →  fraction = (13-retMonth)/12
//
// retirementMonth=1 (the schema default) yields fractions 0 and 1 — i.e., the
// legacy "full year before, full year on/after" behavior, so existing plans
// are unaffected.

import type { ClientInfo } from "./types";

type RetirementRef =
  | "client_retirement"
  | "spouse_retirement"
  | string
  | null
  | undefined;

const isClientRet = (r: RetirementRef): boolean => r === "client_retirement";
const isSpouseRet = (r: RetirementRef): boolean => r === "spouse_retirement";
const isRetirementRef = (r: RetirementRef): boolean =>
  isClientRet(r) || isSpouseRet(r);

function birthYear(dob: string | undefined): number | null {
  if (!dob) return null;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function retirementYearFor(ref: RetirementRef, client: ClientInfo): number | null {
  if (isClientRet(ref)) {
    const by = birthYear(client.dateOfBirth);
    return by == null ? null : by + client.retirementAge;
  }
  if (isSpouseRet(ref)) {
    if (client.spouseRetirementAge == null) return null;
    const by = birthYear(client.spouseDob);
    return by == null ? null : by + client.spouseRetirementAge;
  }
  return null;
}

function retirementMonthFor(ref: RetirementRef, client: ClientInfo): number {
  const raw = isSpouseRet(ref) ? client.spouseRetirementMonth : client.retirementMonth;
  const m = raw ?? 1;
  // Clamp defensively; DB constraint should keep this in 1..12 but a bad
  // import or hand-edited row shouldn't crash projection.
  if (m < 1) return 1;
  if (m > 12) return 12;
  return m;
}

/**
 * Proration multiplier for a "starts at retirement" item in the given year.
 *
 *   - If `ref` is not a retirement ref → 1 (no effect).
 *   - If `year` is not the resolved retirement year → 1.
 *   - Otherwise → (13 - retirementMonth) / 12.
 *
 * Apply this to the year's amount AFTER growth/inflation are computed.
 */
export function startProrationFactor(
  ref: RetirementRef,
  year: number,
  client: ClientInfo,
): number {
  if (!isRetirementRef(ref)) return 1;
  const retYear = retirementYearFor(ref, client);
  if (retYear == null || year !== retYear) return 1;
  const m = retirementMonthFor(ref, client);
  return (13 - m) / 12;
}

/**
 * Combined inclusion + multiplier for any time-windowed item that may have
 * retirement-linked start/end refs. Returns:
 *
 *   { include: boolean, factor: number }
 *
 * `include` matches the legacy inclusion test (year >= startYear && year <= endYear),
 * extended to include the retirement year for end-at-retirement items when
 * retirementMonth > 1. `factor` is the proration multiplier (1 outside the
 * retirement year, < 1 in the retirement year for retirement-linked items).
 *
 * Callers do their own growth/inflation math and multiply the result by `factor`.
 */
export function itemProrationGate(
  item: {
    startYear: number;
    endYear: number;
    startYearRef?: string | null;
    endYearRef?: string | null;
  },
  year: number,
  client: ClientInfo,
): { include: boolean; factor: number } {
  if (year < item.startYear) return { include: false, factor: 0 };
  const endCheck = endInclusionAndFactor(item.endYearRef, year, item.endYear, client);
  if (!endCheck.included) return { include: false, factor: 0 };
  const startFactor = startProrationFactor(item.startYearRef, year, client);
  // At most one of endCheck.factor and startFactor will be < 1 in any given
  // year — they apply to opposite boundaries of the same item.
  return { include: true, factor: endCheck.factor * startFactor };
}

/**
 * Result of evaluating an end-at-retirement item in a given year.
 *   - `included: false` → year is past the item's effective end; skip.
 *   - `included: true, factor: 1` → normal full year (year < retirementYear).
 *   - `included: true, factor: f` (0 < f < 1) → partial retirement-year amount.
 *
 * The engine should treat the item as active when this returns
 * `included: true` and multiply the computed full-year amount by `factor`.
 *
 * Note: when `ref` is null/non-retirement, this returns
 * `{ included: year <= endYear, factor: 1 }` — the standard inclusion rule.
 */
export function endInclusionAndFactor(
  ref: RetirementRef,
  year: number,
  endYear: number,
  client: ClientInfo,
): { included: boolean; factor: number } {
  if (!isRetirementRef(ref)) {
    return year <= endYear
      ? { included: true, factor: 1 }
      : { included: false, factor: 0 };
  }
  // For end-at-retirement items, resolveMilestone with position="end" returns
  // (retirementYear - 1). Standard inclusion through endYear is the full-year
  // run-up. The retirement year itself is handled by the proration extension.
  if (year <= endYear) return { included: true, factor: 1 };
  const retYear = retirementYearFor(ref, client);
  if (retYear == null || year !== retYear) return { included: false, factor: 0 };
  const m = retirementMonthFor(ref, client);
  if (m <= 1) return { included: false, factor: 0 };
  return { included: true, factor: (m - 1) / 12 };
}
