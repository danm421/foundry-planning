import { describe, it, expect } from "vitest";
import {
  synthesizeLtcBenefits,
  type LtcBenefitsInput,
  type LtcBenefitsResult,
  type LtcLifePolicyTerms,
} from "../ltc-benefits";
import type { CareSetting, LtcPolicy } from "../types";

// A traditional policy: $6,000/month, 3-year pool, 90-day wait, no inflation,
// reimbursement, issued 2020. Every test changes only what it is about.
const traditional = (over: Partial<LtcPolicy> = {}): LtcPolicy => ({
  id: "trad", name: "Genworth", insured: "client", carrier: null, kind: "standalone",
  lifePolicyAccountId: null, issueYear: 2020, benefitAmount: 6000, benefitUnit: "month",
  riderBenefitMode: null, riderMonthlyPct: null, benefitPeriodMode: "years", benefitPeriodYears: 3,
  riderMaxPct: null, extensionYears: 0, residualDeathBenefit: 0, eliminationDays: 90, homeCarePct: 1,
  inflationRider: "none", inflationRate: 0.03, benefitType: "reimbursement", sharedCare: false,
  annualPremium: 0, premiumPayMode: "paid_up", premiumPayToAge: null, premiumPayYears: null,
  partnership: false, notes: null, ...over,
});

// A rider: 2% of the face a month, up to 100%, no wait, on account "life-1".
const rider = (over: Partial<LtcPolicy> = {}): LtcPolicy =>
  traditional({
    id: "rider", name: "Whole life rider", kind: "life_rider", lifePolicyAccountId: "life-1",
    benefitAmount: 0, riderBenefitMode: "pct_of_face", riderMonthlyPct: 0.02,
    benefitPeriodMode: null, benefitPeriodYears: null, riderMaxPct: 1, eliminationDays: 0, ...over,
  });

const lifeFace = (face: number, over: Partial<LtcLifePolicyTerms> = {}): LtcLifePolicyTerms => ({
  faceForYear: () => face, firstYear: null, lastYear: null, ...over,
});

type Care = { person: "client" | "spouse"; startYear: number; years: number; monthlyCost: number; careSetting?: CareSetting };

/** Flat monthly cost, so every paid month adds up by hand. */
function run(
  people: Care[],
  policies: LtcPolicy[],
  extra: Partial<Pick<LtcBenefitsInput, "lifePolicies" | "deathYearByPerson">> = {},
): LtcBenefitsResult {
  const careCostByPersonYear: LtcBenefitsInput["careCostByPersonYear"] = { client: {}, spouse: {} };
  for (const c of people) {
    for (let y = c.startYear; y < c.startYear + c.years; y++) careCostByPersonYear[c.person][y] = c.monthlyCost * 12;
  }
  return synthesizeLtcBenefits({
    people: people.map((c) => ({
      person: c.person, startYear: c.startYear, endYear: c.startYear + c.years - 1,
      careSetting: c.careSetting ?? "nursing_private",
    })),
    careCostByPersonYear,
    policies,
    lifePolicies: extra.lifePolicies ?? {},
    deathYearByPerson: extra.deathYearByPerson ?? {},
  });
}
const paid = (r: LtcBenefitsResult, policyId: string) =>
  r.byPolicy.find((b) => b.policyId === policyId)?.paidByYear ?? {};
const john = (years: number, monthlyCost: number, careSetting?: CareSetting): Care =>
  ({ person: "client", startYear: 2055, years, monthlyCost, careSetting });

describe("traditional policies", () => {
  it("a 90-day wait leaves about 9 paid months in the first year", () => {
    const r = run([john(3, 10_000)], [traditional()]);
    // 90 / 30.4375 = 2.96 → months 0–2 unpaid; 9 × 6,000 = 54,000; then 12 × 6,000.
    // Pool 216,000 − 54,000 − 72,000 = 90,000 ≥ 72,000, so 2057 pays in full.
    expect(paid(r, "trad")).toEqual({ 2055: 54_000, 2056: 72_000, 2057: 72_000 });
    expect(r.coveredByPersonYear.client).toEqual({ 2055: 54_000, 2056: 72_000, 2057: 72_000 });
    expect(r.incomes).toEqual([{
      id: "ltc-benefit-trad", type: "other", name: "Genworth benefit", annualAmount: 0,
      startYear: 2055, endYear: 2057, growthRate: 0,
      scheduleOverrides: { 2055: 54_000, 2056: 72_000, 2057: 72_000 },
      owner: "client", taxType: "tax_exempt", sourceLtcPolicyId: "trad",
    }]);
  });

  it("below the limit, reimbursement pays the cost and indemnity pays the limit", () => {
    // Cost 5,000/mo < limit 6,000. 9 paid months in the first year.
    expect(paid(run([john(1, 5_000)], [traditional()]), "trad")).toEqual({ 2055: 45_000 }); // 9 × 5,000
    expect(paid(run([john(1, 5_000)], [traditional({ benefitType: "indemnity" })]), "trad")).toEqual({ 2055: 54_000 }); // 9 × 6,000
  });

  it("inflation grows the limit from the ISSUE year, not the claim year", () => {
    // Issued 2045, claim 2055: 10 years of growth. A claim-year factor would pay 9 × 6,000 = 54,000.
    // compound: 6,000 × 1.03^10 = 6,000 × 1.3439164 = 8,063.50/mo; × 9 = 72,571.48
    const compound = run([john(1, 10_000)], [traditional({ issueYear: 2045, inflationRider: "compound" })]);
    expect(paid(compound, "trad")[2055]).toBeCloseTo(72_571.48, 1);
    // simple: 6,000 × (1 + 0.03 × 10) = 7,800/mo; × 9 = 70,200
    const simple = run([john(1, 10_000)], [traditional({ issueYear: 2045, inflationRider: "simple" })]);
    expect(paid(simple, "trad")[2055]).toBeCloseTo(70_200, 6);
  });

  it("a 3-year pool runs past 3 years when the cost is below the limit", () => {
    // No wait; 5,000/mo from a 216,000 pool: 3 × 60,000 = 180,000, then 36,000 left in 2058
    // (7 × 5,000 + 1,000), then nothing.
    const r = run([john(5, 5_000)], [traditional({ eliminationDays: 0 })]);
    expect(paid(r, "trad")).toEqual({ 2055: 60_000, 2056: 60_000, 2057: 60_000, 2058: 36_000 });
  });

  it("the remaining pool grows with the inflation rider", () => {
    // Issued 2055 (factor 1), compound 3%, no wait, cost above the limit.
    // 2055: 12 × 6,000 = 72,000              → 144,000 left in 2055 dollars
    // 2056: 12 × 6,180 = 74,160 (= 72,000 × 1.03) → 72,000 left in 2055 dollars
    // 2057: 12 × 6,365.40 = 76,384.80        → empty
    // Total 222,544.80 > the 216,000 the pool started at.
    const r = run([john(4, 10_000)], [traditional({ issueYear: 2055, inflationRider: "compound", eliminationDays: 0 })]);
    const p = paid(r, "trad");
    expect(p[2055]).toBeCloseTo(72_000, 6);
    expect(p[2056]).toBeCloseTo(74_160, 4);
    expect(p[2057]).toBeCloseTo(76_384.8, 4);
    expect(p[2058]).toBeUndefined();
  });

  it("a lifetime policy never runs out", () => {
    const r = run([john(6, 10_000)], [traditional({ benefitPeriodMode: "lifetime", benefitPeriodYears: null, eliminationDays: 0 })]);
    expect(paid(r, "trad")).toEqual({ 2055: 72_000, 2056: 72_000, 2057: 72_000, 2058: 72_000, 2059: 72_000, 2060: 72_000 });
  });

  it("a 50% home-care benefit halves the limit for in-home care only", () => {
    // 6,000 × 0.5 = 3,000; × 9 = 27,000. A nursing home pays the full 6,000 × 9 = 54,000.
    expect(paid(run([john(1, 10_000, "in_home")], [traditional({ homeCarePct: 0.5 })]), "trad")).toEqual({ 2055: 27_000 });
    expect(paid(run([john(1, 10_000)], [traditional({ homeCarePct: 0.5 })]), "trad")).toEqual({ 2055: 54_000 });
  });

  it("a policy issued after care began pays from its issue year (Dan, 2026-10-08)", () => {
    // Care 2055–2057, issued 2056: the wait counts from Jan 2056 → 9 × 6,000 = 54,000, then 72,000.
    const r = run([john(3, 10_000)], [traditional({ issueYear: 2056 })]);
    expect(paid(r, "trad")).toEqual({ 2056: 54_000, 2057: 72_000 });
    expect(r.byPolicy[0]).toMatchObject({ firstYear: 2056, monthlyLimit: 6000, total: 126_000 });
    // Issued after care ends: never in force, pays nothing, no income row.
    const late = run([john(3, 10_000)], [traditional({ issueYear: 2058 })]);
    expect(late.byPolicy[0]).toMatchObject({ firstYear: null, monthlyLimit: 0, total: 0 });
    expect(late.incomes).toEqual([]);
  });

  it("a policy insuring someone who is not in care pays nothing", () => {
    const r = run([john(3, 10_000)], [traditional({ insured: "spouse" })]);
    expect(r.byPolicy).toEqual([]);
    expect(r.incomes).toEqual([]);
  });
});

describe("shared care", () => {
  // John: a 1-year pool (72,000). Jane: a 3-year pool (216,000). Both shared, no wait.
  const johnPolicy = traditional({ id: "j", benefitPeriodYears: 1, sharedCare: true, eliminationDays: 0 });
  const janePolicy = traditional({ id: "s", insured: "spouse", sharedCare: true, eliminationDays: 0 });

  it("once John's own pool is spent he draws on Jane's", () => {
    // 2055 from his own 72,000; 2056 and 2057 at 72,000 a year from Jane's 216,000.
    const r = run([john(3, 10_000)], [johnPolicy, janePolicy]);
    expect(paid(r, "j")).toEqual({ 2055: 72_000, 2056: 72_000, 2057: 72_000 });
    // Control: without sharing on his policy, only his own 72,000.
    expect(paid(run([john(3, 10_000)], [{ ...johnPolicy, sharedCare: false }, janePolicy]), "j")).toEqual({ 2055: 72_000 });
    // Both policies must be shared.
    expect(paid(run([john(3, 10_000)], [johnPolicy, { ...janePolicy, sharedCare: false }]), "j")).toEqual({ 2055: 72_000 });
  });

  it("a partner's pool can't be drawn after the partner's death (not moved to the survivor in v1)", () => {
    const r = run([john(3, 10_000)], [johnPolicy, janePolicy], { deathYearByPerson: { spouse: 2056 } });
    expect(paid(r, "j")).toEqual({ 2055: 72_000, 2056: 72_000 });
  });

  it("a partner's pool can't be drawn before the partner's policy is issued (Dan, 2026-10-08)", () => {
    // Jane's shared 3-year policy is issued 2057. 2055: 12 × 6,000 = 72,000 from John's own pool (now empty).
    // 2056: her policy doesn't exist yet → nothing. 2057: 12 × 6,000 = 72,000 from her 216,000 pool.
    const r = run([john(3, 10_000)], [johnPolicy, { ...janePolicy, issueYear: 2057 }]);
    expect(paid(r, "j")).toEqual({ 2055: 72_000, 2057: 72_000 });
  });

  it("both in care: the client draws first when one pool can't cover both in a month", () => {
    // John 6,000/mo from a 72,000 pool; Jane 5,500/mo from 5,500 × 12 × 2 = 132,000. Both 2055–2057.
    // 2055: John 72,000 (his pool now empty), Jane 66,000 (66,000 left).
    // 2056: each month John draws 6,000 from Jane's pool, then Jane takes 5,500: 11,500/mo.
    //   Jan–May: 5 × 11,500 = 57,500 → 8,500 left. June: John 6,000 first → 2,500 left; Jane gets 2,500.
    //   John 6 × 6,000 = 36,000; Jane 5 × 5,500 + 2,500 = 30,000. (Jane first would give 33,000 each.)
    const jane = traditional({ id: "s", insured: "spouse", benefitAmount: 5500, benefitPeriodYears: 2, sharedCare: true, eliminationDays: 0 });
    const r = run(
      [john(3, 10_000), { person: "spouse", startYear: 2055, years: 3, monthlyCost: 10_000 }],
      [johnPolicy, jane],
    );
    expect(paid(r, "j")).toEqual({ 2055: 72_000, 2056: 36_000 });
    expect(paid(r, "s")).toEqual({ 2055: 66_000, 2056: 30_000 });
  });
});

describe("riders", () => {
  const lifePolicies = { "life-1": lifeFace(500_000) };

  it("percent-of-face and fixed limits, stopping at the cap", () => {
    // 2% × 500,000 = 10,000/mo (cost 12,000): 4 × 120,000 = 480,000, then 20,000 left of the cap in 2059.
    const pct = run([john(5, 12_000)], [rider()], { lifePolicies });
    expect(paid(pct, "rider")).toEqual({ 2055: 120_000, 2056: 120_000, 2057: 120_000, 2058: 120_000, 2059: 20_000 });
    expect(pct.accelerationByAccount["life-1"]).toEqual({
      byYear: { 2055: 120_000, 2056: 120_000, 2057: 120_000, 2058: 120_000, 2059: 20_000 },
      minimumDeathBenefit: 0,
    });
    // Fixed $8,000/mo: 5 × 96,000 = 480,000 < 500,000 cap.
    const fixed = run([john(5, 12_000)], [rider({ riderBenefitMode: "fixed", riderMonthlyPct: null, benefitAmount: 8000 })], { lifePolicies });
    expect(paid(fixed, "rider")).toEqual({ 2055: 96_000, 2056: 96_000, 2057: 96_000, 2058: 96_000, 2059: 96_000 });
  });

  it("the cap respects the guaranteed minimum, and the extension pays on without touching the face", () => {
    // Cap = 500,000 − 100,000 = 400,000. 2055–57: 360,000. 2058 Jan–Apr: 40,000 → cap reached.
    // Extension 12 months from May 2058: 8 × 10,000 = 80,000 in 2058, 4 × 10,000 = 40,000 in 2059.
    const r = run([john(5, 12_000)], [rider({ residualDeathBenefit: 100_000, extensionYears: 1 })], { lifePolicies });
    expect(paid(r, "rider")).toEqual({ 2055: 120_000, 2056: 120_000, 2057: 120_000, 2058: 120_000, 2059: 40_000 });
    expect(r.accelerationByAccount["life-1"]).toEqual({
      byYear: { 2055: 120_000, 2056: 120_000, 2057: 120_000, 2058: 40_000 },
      minimumDeathBenefit: 100_000,
    });
  });

  it("inflation grows the rider's limit but never its cap (Dan, 2026-10-08)", () => {
    // Issued 2045, compound 3%: 2055 limit = 10,000 × 1.03^10 = 13,439.16; × 12 = 161,269.97.
    // Three full years and a 1,530.66 stub in 2058 use up exactly the fixed 500,000 cap; 2059 pays nothing.
    const r = run([john(5, 30_000)], [rider({ issueYear: 2045, inflationRider: "compound" })], { lifePolicies });
    const p = paid(r, "rider");
    expect(p[2055]).toBeCloseTo(161_269.97, 1);
    expect(r.byPolicy[0].total).toBeCloseTo(500_000, 4);
    expect(p[2059]).toBeUndefined();
  });

  it("a rider stops when its term policy lapses, and starts only once its life policy does", () => {
    const lapsed = run([john(3, 12_000)], [rider()], { lifePolicies: { "life-1": lifeFace(500_000, { lastYear: 2056 }) } });
    expect(paid(lapsed, "rider")).toEqual({ 2055: 120_000, 2056: 120_000 });
    expect(lapsed.accelerationByAccount["life-1"].byYear).toEqual({ 2055: 120_000, 2056: 120_000 });
    const later = run([john(3, 12_000)], [rider()], { lifePolicies: { "life-1": lifeFace(500_000, { firstYear: 2056 }) } });
    expect(paid(later, "rider")).toEqual({ 2056: 120_000, 2057: 120_000 });
  });

  it("a rider whose life policy isn't in the plan pays nothing", () => {
    const r = run([john(3, 12_000)], [rider()], { lifePolicies: {} });
    expect(r.byPolicy).toEqual([]);
    expect(r.incomes).toEqual([]);
    expect(r.accelerationByAccount).toEqual({});
  });
});

describe("which policy pays first", () => {
  const lifePolicies = { "life-1": lifeFace(500_000) };

  it("the traditional policy pays before the rider, whatever order they're listed in", () => {
    // Cost 15,000/mo: traditional 6,000, then the rider 9,000 of its 10,000 limit.
    const r = run([john(1, 15_000)], [rider(), traditional({ eliminationDays: 0 })], { lifePolicies });
    expect(paid(r, "trad")).toEqual({ 2055: 72_000 });
    expect(paid(r, "rider")).toEqual({ 2055: 108_000 }); // 12 × 9,000
    expect(r.accelerationByAccount["life-1"].byYear).toEqual({ 2055: 108_000 });
    expect(r.coveredByPersonYear.client).toEqual({ 2055: 180_000 }); // the whole 15,000 × 12
  });

  it("an indemnity rider pays its full limit regardless of the order", () => {
    const r = run([john(1, 15_000)], [traditional({ eliminationDays: 0 }), rider({ benefitType: "indemnity" })], { lifePolicies });
    expect(paid(r, "rider")).toEqual({ 2055: 120_000 }); // 12 × 10,000, though only 9,000 a month was unpaid
  });

  it("no one in care pays nothing", () => {
    const r = run([], [traditional()]);
    expect(r).toEqual({ incomes: [], coveredByPersonYear: { client: {}, spouse: {} }, accelerationByAccount: {}, byPolicy: [] });
  });
});
