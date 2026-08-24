import type { ClientInfo, DisabilityEvent, DisabilityPolicy, Income } from "./types";
import { computeIncome } from "./income";
import { lastDisabledYear } from "./disability-event";
import { fraForBirthDate } from "./socialSecurity/fra";

/** 365.25 / 12. The single definition — never re-type this literal. */
export const DAYS_PER_MONTH = 30.4375;

/** A seam shorter than one week is arithmetic noise from the days→months
 *  conversion, not a coverage decision. The standard 13-week / 90-day pairing
 *  leaves a one-DAY seam; warning about it would train advisors to ignore the
 *  warning that matters. */
export const CONTINUITY_TOLERANCE_MONTHS = 7 / DAYS_PER_MONTH;

export interface CoverageWindow {
  /** Months from the date of disability. */
  startMonth: number;
  endMonth: number;
  monthlyBenefit: number;
}

export interface CoverageSeam {
  kind: "gap" | "overlap";
  months: number;
}

export interface ResolvedCoverage {
  policyId: string;
  coveredEarnings: number;
  shortTerm: CoverageWindow | null;
  longTerm: CoverageWindow | null;
  /** Non-null when an age-based benefit period could not be resolved because
   *  the insured has no date of birth. `longTerm` is null in that case — the
   *  policy pays nothing and the UI shows a warning. Every silent fallback
   *  (pay to plan end, pay zero, borrow the client's DOB) is wrong in a way the
   *  advisor would not see. */
  unresolved: "missing_dob" | null;
  seam: CoverageSeam | null;
}

const monthsFromDays = (days: number) => days / DAYS_PER_MONTH;

/** Builds a window that can never end before it starts. `benefitForYear` clamps
 *  paid months to 0 either way, but `ResolvedCoverage` is ALSO the coverage
 *  timeline's data source — an inverted window (a disability beginning after
 *  the `to_age` target, or a duration shorter than the elimination period)
 *  would draw a bar running backwards. */
function coverageWindow(
  startMonth: number,
  endMonth: number,
  monthlyBenefit: number,
): CoverageWindow {
  return { startMonth, endMonth: Math.max(startMonth, endMonth), monthlyBenefit };
}

/** Absolute month index for a calendar year + 1-based month. */
const absMonth = (year: number, month1: number) => year * 12 + (month1 - 1);

function cap(monthly: number, monthlyMax: number | null): number {
  return monthlyMax == null ? monthly : Math.min(monthly, monthlyMax);
}

function insuredDob(policy: DisabilityPolicy, client: ClientInfo): string | null {
  return policy.insured === "spouse" ? (client.spouseDob ?? null) : client.dateOfBirth;
}

/** Months from 1 Jan of `startYear` until the benefit period ends.
 *  Returns null when an age-based period cannot resolve. */
function resolveEndMonth(
  policy: DisabilityPolicy,
  startYear: number,
  client: ClientInfo,
  planEndYear: number,
): number | null {
  const period = policy.longTerm!.benefitPeriod;
  if (period.mode === "years") return period.years * 12;
  if (period.mode === "lifetime") return (planEndYear - startYear + 1) * 12;

  const dob = insuredDob(policy, client);
  if (!dob) return null;
  const [birthYear, birthMonth] = dob.split("-").map(Number);
  const targetAgeMonths =
    period.mode === "to_age" ? period.age * 12 : fraForBirthDate(dob).totalMonths;
  return absMonth(birthYear, birthMonth) + targetAgeMonths - absMonth(startYear, 1);
}

export function resolveCoverage(
  policy: DisabilityPolicy,
  coveredEarnings: number,
  startYear: number,
  client: ClientInfo,
  planEndYear: number,
): ResolvedCoverage {
  const monthlyEarnings = coveredEarnings / 12;

  const shortTerm: CoverageWindow | null = policy.shortTerm
    ? coverageWindow(
        monthsFromDays(policy.shortTerm.eliminationDays),
        // Duration is measured FROM THE DATE OF DISABILITY, so the end is the
        // duration itself — the elimination period is unpaid time inside it.
        monthsFromDays(policy.shortTerm.durationWeeks * 7),
        cap(monthlyEarnings * policy.shortTerm.benefitPct, policy.shortTerm.monthlyMax),
      )
    : null;

  let longTerm: CoverageWindow | null = null;
  let unresolved: "missing_dob" | null = null;
  if (policy.longTerm) {
    const endMonth = resolveEndMonth(policy, startYear, client, planEndYear);
    if (endMonth == null) {
      unresolved = "missing_dob";
    } else {
      longTerm = coverageWindow(
        monthsFromDays(policy.longTerm.eliminationDays),
        endMonth,
        cap(monthlyEarnings * policy.longTerm.benefitPct, policy.longTerm.monthlyMax),
      );
    }
  }

  let seam: CoverageSeam | null = null;
  if (shortTerm && longTerm) {
    const delta = longTerm.startMonth - shortTerm.endMonth;
    if (delta > CONTINUITY_TOLERANCE_MONTHS) seam = { kind: "gap", months: delta };
    else if (-delta > CONTINUITY_TOLERANCE_MONTHS) seam = { kind: "overlap", months: -delta };
  }

  return { policyId: policy.id, coveredEarnings, shortTerm, longTerm, unresolved, seam };
}

const overlapMonths = (a: number, b: number, c: number, d: number) =>
  Math.max(0, Math.min(b, d) - Math.max(a, c));

/** Dollars paid in one calendar year. Windows that overlap SUM — the engine
 *  does not silently coordinate benefits the way an insurer would. */
export function benefitForYear(
  coverage: ResolvedCoverage,
  startYear: number,
  year: number,
  colaRate: number,
): number {
  const yearIndex = year - startYear;
  if (yearIndex < 0) return 0;
  const from = yearIndex * 12;
  const to = from + 12;

  let months = 0;
  let paid = 0;
  for (const w of [coverage.shortTerm, coverage.longTerm]) {
    if (!w) continue;
    const m = overlapMonths(w.startMonth, w.endMonth, from, to);
    months += m;
    paid += m * w.monthlyBenefit;
  }
  if (months === 0) return 0;
  // COLA rides on the CAPPED benefit and starts in the second disability year.
  return paid * (1 + colaRate) ** yearIndex;
}

export interface SynthesizeDisabilityInput {
  /** Income rows as they stand BEFORE applyDisabilityEvent suspends the
   *  paycheck. Reading them afterwards yields $0 covered earnings — a benefit
   *  row that exists and pays nothing. */
  incomesBeforeDisability: Income[];
  event: DisabilityEvent | undefined;
  policies: DisabilityPolicy[];
  client: ClientInfo;
  planStartYear: number;
  planEndYear: number;
  inflationRate: number;
}

/** Earnings the policy insures, in `startYear` dollars. Exported so the policy
 *  dialog's coverage timeline reads the same number the projection pays on —
 *  a second derivation on the UI side is how the screen and the engine drift
 *  apart.
 *
 *  ⚠️ `opts.incomes` MUST be the income rows as they stand BEFORE
 *  `applyDisabilityEvent` suspends the paycheck. Reading them afterwards
 *  yields $0 covered earnings, a benefit row that exists and pays nothing, and
 *  NO ERROR anywhere — the plan simply shows an uninsured disability. */
export function resolveCoveredEarnings(
  policy: DisabilityPolicy,
  opts: {
    /** Income rows from before the disability is applied — see the warning
     *  above. Passing suspended rows silently produces a $0 benefit. */
    incomes: Income[];
    client: ClientInfo;
    startYear: number;
    planStartYear: number;
    inflationRate: number;
  },
): number {
  if (policy.coveredEarningsMode === "manual") {
    const base = policy.coveredEarningsAmount ?? 0;
    const years = Math.max(0, opts.startYear - opts.planStartYear);
    return base * (1 + opts.inflationRate) ** years;
  }
  // Group plans insure W-2 base earnings; business / K-1 income is excluded.
  return computeIncome(
    opts.incomes,
    opts.startYear,
    opts.client,
    (inc) => inc.owner === policy.insured && inc.type === "salary",
  ).salaries;
}

export function synthesizeDisabilityBenefits(input: SynthesizeDisabilityInput): Income[] {
  const { event, policies, client, planEndYear } = input;
  if (!event || policies.length === 0) return [];

  const out: Income[] = [];
  for (const policy of policies) {
    if (policy.insured !== event.person) continue;

    const coveredEarnings = resolveCoveredEarnings(policy, {
      incomes: input.incomesBeforeDisability,
      client,
      startYear: event.startYear,
      planStartYear: input.planStartYear,
      inflationRate: input.inflationRate,
    });
    const coverage = resolveCoverage(
      policy,
      coveredEarnings,
      event.startYear,
      client,
      planEndYear,
    );

    // A disability that ends stops the benefit with it: the insured is back at
    // work from `endYear + 1`, so a policy whose benefit period runs longer
    // simply stops paying. Truncating the payment YEARS rather than the
    // coverage windows keeps `ResolvedCoverage` a statement about the CONTRACT,
    // which is what the Insurance page's timeline and the solver's readout draw.
    const lastPaidYear = Math.min(planEndYear, lastDisabledYear(event) ?? planEndYear);

    const scheduleOverrides: Record<number, number> = {};
    for (let year = event.startYear; year <= lastPaidYear; year++) {
      const amount = benefitForYear(coverage, event.startYear, year, policy.colaRate);
      if (amount > 0) scheduleOverrides[year] = amount;
    }
    const years = Object.keys(scheduleOverrides).map(Number);
    if (years.length === 0) continue;

    out.push({
      id: `disability-benefit-${policy.id}`,
      type: "other",
      name: `${policy.name} benefit`,
      annualAmount: 0,
      startYear: Math.min(...years),
      endYear: Math.max(...years),
      growthRate: 0,
      scheduleOverrides,
      owner: policy.insured,
      // NEVER "earned_income": disability benefits are not FICA wages and must
      // not create a savings base or an earned-income credit.
      taxType: policy.benefitTaxable ? "ordinary_income" : "tax_exempt",
      // Deliberately NO `source: "policy"` — withSynthesizedPolicyIncome strips
      // every source === "policy" row and re-derives from life-insurance
      // ACCOUNTS, which would make this row vanish.
      sourceDisabilityPolicyId: policy.id,
    });
  }
  return out;
}
