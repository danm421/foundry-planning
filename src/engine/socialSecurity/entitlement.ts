// src/engine/socialSecurity/entitlement.ts
//
// Month-level Social Security start dates.
//
// The projection runs on calendar years, but SSA entitlement begins in a
// specific MONTH, so the claim year is almost never a full 12 payments. A
// December birthday claiming at 67 collects one month that year, not twelve.
// Everything here answers "which month does the money start?" so the annual
// engine can prorate the first year instead of paying it in full.
//
// Three SSA rules drive the arithmetic:
//
//   1. A person attains an age on the DAY BEFORE their birthday (common law,
//      20 CFR 404.2(c)(4)). Only births on the 1st cross a month boundary, so
//      a worker born on the 1st attains every age in the PRIOR month.
//   2. Retirement benefits require being age 62 THROUGHOUT a whole month
//      (§202(a), as amended by P.L. 97-35). Combined with rule 1 this means a
//      worker born on the 1st or 2nd is paid from their birthday month, and
//      everyone born on the 3rd through 31st waits one more month.
//   3. Rule 2 binds only at 62. SSA POMS RS 00615.015: "The throughout the
//      month rule does not apply to the attainment of FRA." A claim at FRA or
//      later starts in the month of attainment, whatever the day.
//
// Cash timing is deliberately NOT modeled: SSA pays a month in arrears (the
// July benefit lands in August), so a cash-basis year would run one month
// shorter still. The engine is accrual everywhere else — retirement-month
// proration in `retirement-proration.ts` counts months of entitlement, not
// months of cash — and mixing conventions inside one projection would be
// worse than the residual one-month lag.

import { fraForBirthDate } from "./fra";

const AGE_62_MONTHS = 62 * 12;

/** The calendar month in which a benefit first becomes payable. */
export interface EntitlementMonth {
  year: number;
  /** 1 = January … 12 = December. */
  month: number;
}

/** Absolute month index, so month arithmetic never wraps by hand. */
function toIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromIndex(index: number): EntitlementMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

interface ParsedDob {
  year: number;
  month: number;
  day: number;
}

/** Parse `YYYY-MM-DD`, rejecting anything that is not a real calendar date. */
function parseDob(dob: string): ParsedDob | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Month index in which the worker attains the given age, applying the
 * day-before-the-birthday rule. Births on the 1st land in the prior month;
 * every other birth day attains within the anniversary month itself.
 */
function attainmentIndex(dob: ParsedDob, ageMonths: number): number {
  const anniversary = toIndex(dob.year, dob.month) + ageMonths;
  return dob.day === 1 ? anniversary - 1 : anniversary;
}

/**
 * First month throughout which the worker is age 62 — the earliest month any
 * retirement benefit can be paid. Born on the 1st or 2nd → the anniversary
 * month; born on the 3rd or later → the month after.
 */
function earliestPayableIndex(dob: ParsedDob): number {
  const anniversary = toIndex(dob.year, dob.month) + AGE_62_MONTHS;
  return dob.day <= 2 ? anniversary : anniversary + 1;
}

/**
 * The first calendar month for which a retirement benefit is payable, given a
 * date of birth and an elected claim age in total months (e.g. 67y 6m = 810).
 *
 * Returns `null` when the date of birth is missing or unparseable — callers
 * treat that as "cannot resolve", not as "claims immediately".
 *
 * @param dob ISO `YYYY-MM-DD` date of birth.
 * @param claimAgeMonths Elected claim age as total months (`years * 12 + months`).
 */
export function ssEntitlementMonth(dob: string, claimAgeMonths: number): EntitlementMonth | null {
  const parsed = parseDob(dob);
  if (!parsed) return null;
  // A claim age below the statutory floor (or a claim at exactly 62 by a
  // worker born mid-month) is lifted to the earliest lawful month rather than
  // rejected — the elected age is a preference, the floor is the law.
  const index = Math.max(attainmentIndex(parsed, claimAgeMonths), earliestPayableIndex(parsed));
  return fromIndex(index);
}

/**
 * How many months of benefit fall inside `year` for a stream that begins at
 * `entitlement`. Zero before the start year, `13 - month` in the start year,
 * and a full 12 in every year after.
 *
 * Multiply the annualized monthly benefit by `months / 12`, or by `months`
 * directly if working from the monthly figure.
 */
export function monthsPaidInYear(entitlement: EntitlementMonth | null, year: number): number {
  if (!entitlement) return 0;
  if (year < entitlement.year) return 0;
  if (year > entitlement.year) return 12;
  return 13 - entitlement.month;
}

/**
 * The claim age SSA actually prices, in total months.
 *
 * The early-retirement reduction and delayed-retirement credits are counted in
 * months between the ENTITLEMENT month and the FRA month — not between two
 * birthdays. For a worker born mid-month who claims at exactly 62, the earliest
 * payable month is one month after their birthday, so they are 59 months early
 * rather than 60 and keep a little more of their PIA.
 *
 * Falls back to the requested claim age when the date of birth cannot be
 * parsed, which keeps the amount math working even where timing cannot.
 *
 * @param dob ISO `YYYY-MM-DD` date of birth.
 * @param claimAgeMonths Elected claim age as total months.
 */
export function effectiveClaimAgeMonths(dob: string, claimAgeMonths: number): number {
  const parsed = parseDob(dob);
  if (!parsed) return claimAgeMonths;
  const entitlement = ssEntitlementMonth(dob, claimAgeMonths);
  if (!entitlement) return claimAgeMonths;
  const fraMonths = fraForBirthDate(dob).totalMonths;
  const fraIndex = attainmentIndex(parsed, fraMonths);
  const entitlementIndex = toIndex(entitlement.year, entitlement.month);
  return fraMonths + (entitlementIndex - fraIndex);
}
