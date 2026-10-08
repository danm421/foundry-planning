// src/engine/ltc-benefits.ts
//
// Long-term care policy math. Pure and framework-free.
//
// One copy of each formula: the Insurance page's read-back line
// (`ltc-labels.ts`), the premium synthesizer and the payout walk below all
// call these, so the screen and the projection cannot drift.
import type { CareSetting, Income, LtcAcceleration, LtcPolicy } from "./types";

/** The inflation rider's growth factor for `year`, measured from the ISSUE
 *  year (not the claim year). 1 in or before the issue year. */
export function ltcInflationFactor(
  p: Pick<LtcPolicy, "inflationRider" | "inflationRate" | "issueYear">,
  year: number,
): number {
  const n = Math.max(0, year - p.issueYear);
  if (p.inflationRider === "simple") return 1 + p.inflationRate * n;
  if (p.inflationRider === "compound") return (1 + p.inflationRate) ** n;
  return 1;
}

/** A benefit as a monthly figure: a daily benefit pays day × 365 / 12. */
export function ltcMonthlyFromUnit(amount: number, unit: LtcPolicy["benefitUnit"]): number {
  return unit === "day" ? (amount * 365) / 12 : amount;
}

/** The id prefix of the premium expense row a traditional policy bills
 *  (`withSynthesizedLtcPremiums`). The LTC pre-pass finds the row by it to
 *  waive or drop it. */
export const LTC_PREMIUM_ID_PREFIX = "ltc-premium-";
export const ltcPremiumExpenseId = (policyId: string): string => `${LTC_PREMIUM_ID_PREFIX}${policyId}`;

/** The id of the tax-free income row a policy's benefits are paid through. */
export const ltcBenefitIncomeId = (policyId: string): string => `ltc-benefit-${policyId}`;

type StandaloneMath = Pick<
  LtcPolicy,
  "benefitAmount" | "benefitUnit" | "inflationRider" | "inflationRate" | "issueYear"
>;

/** A traditional policy's monthly benefit in `year`: day → month, grown by its
 *  inflation rider from the issue year. Before the home-care share. */
export function ltcStandaloneMonthly(p: StandaloneMath, year: number): number {
  return ltcMonthlyFromUnit(p.benefitAmount, p.benefitUnit) * ltcInflationFactor(p, year);
}

/** A traditional policy's whole pool in `year` dollars, before any claim:
 *  monthly × 12 × benefit years. Null for a lifetime policy (no limit) or one
 *  with no benefit period entered. */
export function ltcStandalonePool(
  p: StandaloneMath & Pick<LtcPolicy, "benefitPeriodMode" | "benefitPeriodYears">,
  year: number,
): number | null {
  if (p.benefitPeriodMode !== "years" || p.benefitPeriodYears == null) return null;
  return ltcStandaloneMonthly(p, year) * 12 * p.benefitPeriodYears;
}

/** A rider's monthly limit in `year` on a life policy whose death benefit is
 *  `face`: a share of the face, or a fixed amount, grown by the rider's
 *  inflation option. Before the home-care share. */
export function ltcRiderMonthly(
  p: StandaloneMath & Pick<LtcPolicy, "riderBenefitMode" | "riderMonthlyPct">,
  face: number,
  year: number,
): number {
  const base =
    p.riderBenefitMode === "pct_of_face"
      ? (p.riderMonthlyPct ?? 0) * face
      : ltcMonthlyFromUnit(p.benefitAmount, p.benefitUnit);
  return base * ltcInflationFactor(p, year);
}

/** The most a rider can draw from a death benefit of `face`: the lower of
 *  face × its maximum share and face − its guaranteed minimum. FIXED in
 *  death-benefit dollars: it does not grow with the inflation option (Dan,
 *  2026-10-08), so a larger monthly limit uses it up sooner. */
export function ltcRiderCap(p: Pick<LtcPolicy, "riderMaxPct" | "residualDeathBenefit">, face: number): number {
  return Math.max(0, Math.min(face * (p.riderMaxPct ?? 1), face - p.residualDeathBenefit));
}

type Person = "client" | "spouse";

/** A waiting period in days becomes months at 365.25 / 12 days a month. */
const DAYS_PER_MONTH = 30.4375;
/** A draw under half a cent is float dust from a pool already used up. */
const DUST = 0.005;

/** A life policy as an LTC rider sees it. */
export interface LtcLifePolicyTerms {
  /** The contract death benefit in `year` (its schedule, or face), before any rider draw. */
  faceForYear(year: number): number;
  /** First year in force (a policy that starts later), or null = from the plan start. */
  firstYear: number | null;
  /** Last year in force (a term policy, or one the plan sells), or null = no end. */
  lastYear: number | null;
}

/** One person's care, already resolved by the pre-pass. */
export interface LtcCarePeriod {
  person: Person;
  startYear: number;
  /** Last care year, which is also the death year. */
  endYear: number;
  careSetting: CareSetting;
}

export interface LtcBenefitsInput {
  people: LtcCarePeriod[];
  /** Each care year's cost per person, in nominal dollars. */
  careCostByPersonYear: Record<Person, Record<number, number>>;
  /** Every LTC policy on the plan, both people's. */
  policies: LtcPolicy[];
  /** The life policies a rider can draw on, by account id. A rider whose
   *  account is absent pays nothing (resolveLtcEvent warns). */
  lifePolicies: Record<string, LtcLifePolicyTerms>;
  /** Each person's last year alive. A shared-care partner's pool can be drawn
   *  only through it. Absent = no limit. */
  deathYearByPerson: Partial<Record<Person, number>>;
}

/** What one policy paid toward one person's care. */
export interface LtcPolicyPayout {
  policyId: string;
  name: string;
  kind: LtcPolicy["kind"];
  person: Person;
  /** First care year the policy can pay, or null when it is never in force during the care. */
  firstYear: number | null;
  /** Its monthly limit in `firstYear`, after inflation and the home-care share. 0 when never in force. */
  monthlyLimit: number;
  paidByYear: Record<number, number>;
  total: number;
}

export interface LtcBenefitsResult {
  /** One tax-free income row per policy that paid anything. */
  incomes: Income[];
  /** Benefits paid toward each person's care, by year (incl. a shared partner pool). */
  coveredByPersonYear: Record<Person, Record<number, number>>;
  /** Rider draws on each life policy's death benefit. */
  accelerationByAccount: Record<string, LtcAcceleration>;
  /** Every policy of a person in care, in pay order (client first). */
  byPolicy: LtcPolicyPayout[];
}

/** The first care year a policy can pay: care start, or later when the policy
 *  (or a rider's life policy) only starts later. A policy issued after care
 *  began pays from its issue year (Dan, 2026-10-08). Null = never in force
 *  during the care, as for a rider whose life policy isn't in the plan. */
function firstPayingYear(policy: LtcPolicy, life: LtcLifePolicyTerms | null, care: LtcCarePeriod): number | null {
  if (policy.kind === "life_rider" && !life) return null;
  const start = Math.max(care.startYear, policy.issueYear, life?.firstYear ?? care.startYear);
  if (start > care.endYear) return null;
  if (life?.lastYear != null && start > life.lastYear) return null;
  return start;
}

function monthlyLimit(policy: LtcPolicy, life: LtcLifePolicyTerms | null, setting: CareSetting, year: number): number {
  const base =
    policy.kind === "standalone"
      ? ltcStandaloneMonthly(policy, year)
      : ltcRiderMonthly(policy, life!.faceForYear(year), year);
  return base * (setting === "in_home" ? policy.homeCarePct : 1);
}

/** Walk every care month, paying from each policy in order. Pure: the input
 *  is never mutated (Monte Carlo reuses it). */
export function synthesizeLtcBenefits(input: LtcBenefitsInput): LtcBenefitsResult {
  const covered: Record<Person, Record<number, number>> = { client: {}, spouse: {} };
  const accelerationByAccount: Record<string, LtcAcceleration> = {};
  const byPolicy: LtcPolicyPayout[] = [];
  // Client first: when both draw on one shared pool in the same month, the
  // client's claim is met first (spec).
  const people = [...input.people].sort((a, b) =>
    a.person === b.person ? 0 : a.person === "client" ? -1 : 1,
  );
  if (people.length === 0) return { incomes: [], coveredByPersonYear: covered, accelerationByAccount, byPolicy };

  const firstCareYear = Math.min(...people.map((p) => p.startYear));
  const lastCareYear = Math.max(...people.map((p) => p.endYear));
  const monthIndex = (year: number) => (year - firstCareYear) * 12;

  // Traditional pools, held in issue-year dollars: what remains in `year` is
  // base × the inflation factor, so the remaining pool grows with the
  // inflation rider at each year boundary. Both people's pools are kept, in
  // care or not, because a shared-care partner draws on them. A lifetime
  // policy has no entry (no limit). A `years` policy with no period entered
  // has a pool of 0.
  const poolBase = new Map<string, number>();
  for (const p of input.policies) {
    if (p.kind === "standalone" && p.benefitPeriodMode !== "lifetime") {
      poolBase.set(p.id, ltcStandalonePool(p, p.issueYear) ?? 0);
    }
  }
  const takeFromPool = (p: LtcPolicy, amount: number, year: number): number => {
    const base = poolBase.get(p.id);
    if (base === undefined) return amount;
    const factor = ltcInflationFactor(p, year);
    const take = Math.min(amount, base * factor);
    poolBase.set(p.id, Math.max(0, base - take / factor));
    return take;
  };
  // Shared care: the other person's first shared traditional policy with a
  // pool that is issued by `year` (a policy pays from its issue year, Dan,
  // 2026-10-08).
  const sharedPartner = (p: LtcPolicy, year: number): LtcPolicy | undefined =>
    p.sharedCare
      ? input.policies.find(
          (q) =>
            q.insured !== p.insured && q.kind === "standalone" && q.sharedCare && poolBase.has(q.id) && q.issueYear <= year,
        )
      : undefined;

  interface Slot {
    policy: LtcPolicy;
    life: LtcLifePolicyTerms | null;
    firstMonth: number;
    extensionMonthsLeft: number;
    payout: LtcPolicyPayout;
  }
  const slotsByPerson = new Map<Person, Slot[]>();
  for (const care of people) {
    // Pay order: traditional first, then riders, so a rider draws as little of
    // the death benefit as it can. Within each kind, indemnity first: it pays
    // its limit whatever is unpaid, and a reimbursement policy after it pays
    // only what is left. Otherwise as listed (a stable sort), so the order the
    // policies are listed in never changes what they pay.
    const payRank = (p: LtcPolicy) => (p.kind === "standalone" ? 0 : 2) + (p.benefitType === "indemnity" ? 0 : 1);
    const ordered = input.policies
      .filter((p) => p.insured === care.person)
      .sort((a, b) => payRank(a) - payRank(b));
    const slots: Slot[] = [];
    for (const policy of ordered) {
      const life = policy.kind === "life_rider" ? (input.lifePolicies[policy.lifePolicyAccountId ?? ""] ?? null) : null;
      const firstYear = firstPayingYear(policy, life, care);
      const payout: LtcPolicyPayout = {
        policyId: policy.id,
        name: policy.name,
        kind: policy.kind,
        person: care.person,
        firstYear,
        monthlyLimit: firstYear == null ? 0 : monthlyLimit(policy, life, care.careSetting, firstYear),
        paidByYear: {},
        total: 0,
      };
      byPolicy.push(payout);
      if (firstYear != null) {
        slots.push({ policy, life, firstMonth: monthIndex(firstYear), extensionMonthsLeft: policy.extensionYears * 12, payout });
      }
    }
    slotsByPerson.set(care.person, slots);
  }

  const drawStandalone = (s: Slot, want: number, year: number): number => {
    const own = takeFromPool(s.policy, want, year);
    if (want - own < DUST) return own;
    const partner = sharedPartner(s.policy, year);
    if (!partner) return own;
    // v1 does not move a deceased partner's pool to the survivor (spec).
    const partnerDeath = input.deathYearByPerson[partner.insured];
    if (partnerDeath != null && year > partnerDeath) return own;
    return own + takeFromPool(partner, want - own, year);
  };

  const drawnByAccount = new Map<string, number>();
  const drawRider = (s: Slot, want: number, year: number): number => {
    const life = s.life!;
    if (life.lastYear != null && year > life.lastYear) return 0; // the life policy has lapsed or been sold
    const accountId = s.policy.lifePolicyAccountId!;
    const drawn = drawnByAccount.get(accountId) ?? 0;
    const room = ltcRiderCap(s.policy, life.faceForYear(year)) - drawn;
    if (room >= DUST) {
      const take = Math.min(want, room);
      drawnByAccount.set(accountId, drawn + take);
      const acc = (accelerationByAccount[accountId] ??= { byYear: {}, minimumDeathBenefit: 0 });
      acc.byYear[year] = (acc.byYear[year] ?? 0) + take;
      acc.minimumDeathBenefit = Math.max(acc.minimumDeathBenefit, s.policy.residualDeathBenefit);
      return take;
    }
    // Cap reached: the extension pays on at the same limit without touching
    // the death benefit, from the month after the cap.
    if (s.extensionMonthsLeft > 0) {
      s.extensionMonthsLeft -= 1;
      return want;
    }
    return 0;
  };

  for (let t = 0; t < monthIndex(lastCareYear + 1); t++) {
    const year = firstCareYear + Math.floor(t / 12);
    for (const care of people) {
      if (year < care.startYear || year > care.endYear) continue;
      let unpaid = (input.careCostByPersonYear[care.person][year] ?? 0) / 12;
      for (const s of slotsByPerson.get(care.person) ?? []) {
        if (t < s.firstMonth) continue; // not in force yet
        if (t - s.firstMonth < s.policy.eliminationDays / DAYS_PER_MONTH) continue; // waiting period
        const limit = monthlyLimit(s.policy, s.life, care.careSetting, year);
        // Indemnity pays its limit whatever the cost; reimbursement pays what is still unpaid.
        const want = s.policy.benefitType === "indemnity" ? limit : Math.min(limit, unpaid);
        if (want < DUST) continue;
        const paid = s.policy.kind === "standalone" ? drawStandalone(s, want, year) : drawRider(s, want, year);
        if (paid < DUST) continue;
        unpaid = Math.max(0, unpaid - paid);
        s.payout.paidByYear[year] = (s.payout.paidByYear[year] ?? 0) + paid;
        s.payout.total += paid;
        covered[care.person][year] = (covered[care.person][year] ?? 0) + paid;
      }
    }
  }

  const incomes: Income[] = [];
  for (const b of byPolicy) {
    const years = Object.keys(b.paidByYear).map(Number);
    if (years.length === 0) continue;
    incomes.push({
      id: ltcBenefitIncomeId(b.policyId),
      type: "other",
      name: `${b.name} benefit`,
      annualAmount: 0,
      startYear: Math.min(...years),
      endYear: Math.max(...years),
      growthRate: 0,
      scheduleOverrides: { ...b.paidByYear },
      owner: b.person,
      // Tax-free (IRC §7702B). Indemnity above the per-diem limit is deferred.
      taxType: "tax_exempt",
      // NEVER `source: "policy"`: withSynthesizedPolicyIncome strips those
      // rows and re-derives from life-insurance accounts.
      sourceLtcPolicyId: b.policyId,
    });
  }
  return { incomes, coveredByPersonYear: covered, accelerationByAccount, byPolicy };
}
