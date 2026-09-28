// ── Inherited IRA RMDs (non-spouse beneficiary) ──────────────────────────────
//
// Beneficiary distribution rules for a Traditional or Roth IRA inherited from
// someone other than a spouse. Pure: the projection's RMD step (4b) calls
// `inheritedRmdForYear`, and the account form's RMD tab calls
// `describeInheritedRule`, so the two cannot disagree.
//
// Sources: Treas. Reg. §1.401(a)(9)-5(d) (applicable denominator after death)
// and §1.401(a)(9)-9(b) (Single Life Table); IRC §401(a)(9)(H) (SECURE Act
// 10-year rule, deaths 2020+); IRS Notice 2024-35 (10-year yearly RMDs waived
// 2021–2024).

import { controllingFamilyMember } from "./ownership";
import type { Account } from "./types";

/** Single Life Table — Treas. Reg. §1.401(a)(9)-9(b), Table 1 (2022+ regs).
 *  Index = age; the last entry is 120+. Used for every distribution year a
 *  projection can reach: the regs recompute pre-2022 inherited IRAs from this
 *  table using the original age minus the years elapsed, which is exactly the
 *  formula in `inheritedDivisor`. */
const SINGLE_LIFE_TABLE: readonly number[] = [
  84.6, 83.7, 82.8, 81.8, 80.8, 79.8, 78.8, 77.9, 76.9, 75.9, //   0–9
  74.9, 73.9, 72.9, 71.9, 70.9, 69.9, 69.0, 68.0, 67.0, 66.0, //  10–19
  65.0, 64.1, 63.1, 62.1, 61.1, 60.2, 59.2, 58.2, 57.3, 56.3, //  20–29
  55.3, 54.4, 53.4, 52.5, 51.5, 50.5, 49.6, 48.6, 47.7, 46.7, //  30–39
  45.7, 44.8, 43.8, 42.9, 41.9, 41.0, 40.0, 39.0, 38.1, 37.1, //  40–49
  36.2, 35.3, 34.3, 33.4, 32.5, 31.6, 30.6, 29.8, 28.9, 28.0, //  50–59
  27.1, 26.2, 25.4, 24.5, 23.7, 22.9, 22.0, 21.2, 20.4, 19.6, //  60–69
  18.8, 18.0, 17.2, 16.4, 15.6, 14.8, 14.1, 13.3, 12.6, 11.9, //  70–79
  11.2, 10.5, 9.9, 9.3, 8.7, 8.1, 7.6, 7.1, 6.6, 6.1,         //  80–89
  5.7, 5.3, 4.9, 4.6, 4.3, 4.0, 3.7, 3.4, 3.2, 3.0,           //  90–99
  2.8, 2.6, 2.5, 2.3, 2.2, 2.1, 2.1, 2.1, 2.0, 2.0,           // 100–109
  2.0, 2.0, 2.0, 1.9, 1.9, 1.8, 1.8, 1.6, 1.4, 1.1,           // 110–119
  1.0,                                                        // 120+
];

/** First year of death the SECURE Act's beneficiary rules apply to. */
const SECURE_ACT_FIRST_DEATH_YEAR = 2020;
/** IRS Notice 2024-35: yearly RMDs under the 10-year rule are not enforced for
 *  these distribution years; the final regs apply from 2025. */
const TEN_YEAR_WAIVER_FIRST = 2021;
const TEN_YEAR_WAIVER_LAST = 2024;
/** An heir at most this many years younger than the owner is an eligible
 *  designated beneficiary (IRC §401(a)(9)(E)(ii)(V)). */
const ELIGIBLE_AGE_GAP_YEARS = 10;

const INHERITABLE_SUBTYPES: ReadonlySet<string> = new Set(["traditional_ira", "roth_ira"]);

export function singleLifeExpectancy(age: number): number {
  const i = Math.max(0, Math.min(SINGLE_LIFE_TABLE.length - 1, Math.floor(age)));
  return SINGLE_LIFE_TABLE[i];
}

/** Age the original owner's lifetime RMDs began, by birth year. Birth-year
 *  granular: the July-1949 split between 70½ and 72 is approximated as 70½. */
function ownerApplicableAge(ownerBirthYear: number): number {
  if (ownerBirthYear <= 1949) return 70.5;
  if (ownerBirthYear === 1950) return 72;
  if (ownerBirthYear <= 1959) return 73;
  return 75;
}

/** Did the owner die on/after their required beginning date (April 1 of the
 *  year after reaching the applicable age)? Year-granular, so a Jan–Mar death
 *  in that April's year counts as after, and 70½ is placed at `birthYear + 71`.
 *  Roth IRA owners have no required beginning date. */
export function ownerHadStartedRmds(ownerBirthYear: number, deathYear: number, isRoth: boolean): boolean {
  if (isRoth) return false;
  return deathYear > ownerBirthYear + Math.ceil(ownerApplicableAge(ownerBirthYear));
}

export interface InheritedIraInput {
  deathYear: number;
  ownerBirthYear: number;
  /** The account owner — the client or spouse who inherited it. */
  heirBirthYear: number;
  heirDisabled: boolean;
  isRoth: boolean;
}

export interface InheritedIraRule {
  regime: "pre_secure" | "secure";
  method: "stretch" | "ten_year";
  stretchReason: "pre_secure" | "age_gap" | "disabled" | null;
  ownerStartedRmds: boolean;
  /** ten_year only: the account must be empty by Dec 31 of this year. */
  finalYear: number | null;
  /** Whether yearly life-expectancy RMDs apply before any final payout. */
  yearlyRmds: boolean;
}

export function resolveInheritedRule(input: InheritedIraInput): InheritedIraRule {
  const ownerStartedRmds = ownerHadStartedRmds(input.ownerBirthYear, input.deathYear, input.isRoth);
  if (input.deathYear < SECURE_ACT_FIRST_DEATH_YEAR) {
    return { regime: "pre_secure", method: "stretch", stretchReason: "pre_secure", ownerStartedRmds, finalYear: null, yearlyRmds: true };
  }
  const stretchReason =
    input.heirBirthYear - input.ownerBirthYear <= ELIGIBLE_AGE_GAP_YEARS ? "age_gap"
    : input.heirDisabled ? "disabled"
    : null;
  if (stretchReason != null) {
    return { regime: "secure", method: "stretch", stretchReason, ownerStartedRmds, finalYear: null, yearlyRmds: true };
  }
  return {
    regime: "secure",
    method: "ten_year",
    stretchReason: null,
    ownerStartedRmds,
    finalYear: input.deathYear + 10,
    yearlyRmds: ownerStartedRmds,
  };
}

/** Applicable denominator for `year` (Treas. Reg. §1.401(a)(9)-5(d)). The
 *  heir's life expectancy is fixed at their age the year after death and falls
 *  by one each year; when the owner had started RMDs, the owner's remaining
 *  life expectancy (age in the year of death, minus the years elapsed) is used
 *  instead if it is greater. */
function inheritedDivisor(input: InheritedIraInput, rule: InheritedIraRule, year: number): number {
  const firstYear = input.deathYear + 1;
  const heirLe = singleLifeExpectancy(firstYear - input.heirBirthYear) - (year - firstYear);
  if (!rule.ownerStartedRmds) return heirLe;
  const ownerLe = singleLifeExpectancy(input.deathYear - input.ownerBirthYear) - (year - input.deathYear);
  return Math.max(heirLe, ownerLe);
}

export interface InheritedRmdResult {
  amount: number;
  /** Null for a 10-year final payout (no divisor applies). */
  divisor: number | null;
  /** True when the whole current balance comes out this year. */
  fullPayout: boolean;
}

export function inheritedRmdForYear(args: {
  input: InheritedIraInput;
  rule: InheritedIraRule;
  year: number;
  /** Prior Dec-31 balance — the IRS basis for a yearly RMD. */
  priorYearEndBalance: number;
  /** Live balance at the RMD step; a final payout empties exactly this. */
  currentBalance: number;
}): InheritedRmdResult {
  const { input, rule, year, priorYearEndBalance, currentBalance } = args;
  const none: InheritedRmdResult = { amount: 0, divisor: null, fullPayout: false };
  if (year <= input.deathYear || currentBalance <= 0) return none;
  if (rule.finalYear != null && year >= rule.finalYear) {
    return { amount: currentBalance, divisor: null, fullPayout: true };
  }
  if (!rule.yearlyRmds) return none;
  if (rule.method === "ten_year" && year >= TEN_YEAR_WAIVER_FIRST && year <= TEN_YEAR_WAIVER_LAST) return none;
  const divisor = inheritedDivisor(input, rule, year);
  if (divisor <= 1) return { amount: currentBalance, divisor, fullPayout: true };
  return {
    amount: Math.min(currentBalance, Math.max(0, priorYearEndBalance) / divisor),
    divisor,
    fullPayout: false,
  };
}

/** Plain-English rule summary for the account form's RMD tab. */
export function describeInheritedRule(input: InheritedIraInput, rule: InheritedIraRule, referenceYear: number): string {
  const taxNote = input.isRoth ? " Distributions are tax-free." : "";
  if (rule.method === "ten_year") {
    const deadline = `10-year rule — the account must be empty by Dec 31, ${rule.finalYear}.`;
    if (rule.yearlyRmds) {
      return `${deadline} Yearly RMDs are also required before then because the original owner had started RMDs.${taxNote}`;
    }
    const why = input.isRoth ? "Roth IRA owners never start RMDs" : "the original owner had not started RMDs";
    return `${deadline} No yearly RMDs before then because ${why}.${taxNote}`;
  }
  const why =
    rule.stretchReason === "pre_secure" ? "the original owner died before 2020 (pre-SECURE Act)"
    : rule.stretchReason === "age_gap" ? "the heir is no more than 10 years younger than the original owner"
    : "the heir is disabled or chronically ill";
  const year = Math.max(input.deathYear + 1, referenceYear);
  const runsOut = lifeExpectancyRunsOutYear(input, rule, year);
  if (runsOut === year) {
    return `Stretch — life expectancy has run out, so the full balance comes out in ${year}. The stretch applies because ${why}.${taxNote}`;
  }
  const divisor = inheritedDivisor(input, rule, year);
  return `Stretch — yearly RMDs over life expectancy because ${why}. Divisor ${divisor.toFixed(1)} in ${year}, then 1 less each year. Life expectancy runs out in ${runsOut}, when the remaining balance comes out.${taxNote}`;
}

/** First year from `fromYear` whose divisor is ≤ 1 — the year `inheritedRmdForYear`
 *  pays out the whole balance. The divisor falls by exactly 1 a year and starts
 *  no higher than the table's top entry, so the table's length bounds the loop. */
function lifeExpectancyRunsOutYear(input: InheritedIraInput, rule: InheritedIraRule, fromYear: number): number {
  let year = fromYear;
  while (year < fromYear + SINGLE_LIFE_TABLE.length && inheritedDivisor(input, rule, year) > 1) year++;
  return year;
}

/** Ledger label for one year's inherited RMD. */
export function inheritedRmdLabel(rule: InheritedIraRule, result: InheritedRmdResult): string {
  if (result.fullPayout) {
    return result.divisor == null
      ? "Inherited IRA RMD (10-year rule, final payout)"
      : "Inherited IRA RMD (life expectancy exhausted, final payout)";
  }
  const method = rule.method === "ten_year" ? "10-year rule" : "stretch";
  return `Inherited IRA RMD (${method}, divisor ${(result.divisor ?? 0).toFixed(1)})`;
}

export function isInheritedIra(
  account: Pick<Account, "category" | "subType" | "owners" | "inheritedDeathYear" | "inheritedOwnerBirthYear">,
): boolean {
  return (
    account.category === "retirement" &&
    INHERITABLE_SUBTYPES.has(account.subType) &&
    account.inheritedDeathYear != null &&
    account.inheritedOwnerBirthYear != null &&
    controllingFamilyMember(account) != null
  );
}

/** The rule input for an inherited account, or null when it isn't one. */
export function inheritedIraInputFor(account: Account, heirBirthYear: number): InheritedIraInput | null {
  if (!isInheritedIra(account)) return null;
  return {
    deathYear: account.inheritedDeathYear as number,
    ownerBirthYear: account.inheritedOwnerBirthYear as number,
    heirBirthYear,
    heirDisabled: account.inheritedHeirDisabled === true,
    isRoth: account.subType === "roth_ira",
  };
}
