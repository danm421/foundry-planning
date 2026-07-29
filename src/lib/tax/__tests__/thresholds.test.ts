import { describe, it, expect } from "vitest";
import {
  rangeFor, statusFor, THRESHOLD_ITEMS, isNaRange,
  rothIraAllowedContribution, traditionalIraDeductibleAmount, studentLoanInterestDeduction,
} from "../thresholds";
import type { ThresholdFacts, ThresholdHousehold } from "../thresholds";
import type { FilingStatus, TaxYearParameters } from "../types";

const params = {
  rothPhaseout: { startMfj: 242000, endMfj: 252000, startSingle: 153000, endSingle: 168000 },
  iraDeduct: {
    coveredStartMfj: 129000, coveredEndMfj: 149000,
    coveredStartSingle: 81000, coveredEndSingle: 91000,
    spousalStartMfj: 242000, spousalEndMfj: 252000,
  },
  studentLoan: { maxDeduction: 2500, startMfj: 175000, endMfj: 205000, startSingle: 85000, endSingle: 100000 },
  ctc: { perChild: 2200, refundableMax: 1700, odcPerDependent: 500 },
  saversCredit: { mfj: [{ rate: 0.5, agiCeiling: 48500 }, { rate: 0.2, agiCeiling: 52500 }, { rate: 0.1, agiCeiling: 80500 }], single: [], hoh: [] },
  qbi: { thresholdMfj: 403550, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
  amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
  amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
} as unknown as TaxYearParameters;

const household: ThresholdHousehold = {
  filingStatus: "married_joint",
  qualifyingChildren: 1, otherDependents: 0, aotcStudents: 1,
  hasStudentLoanInterest: true, hasRothContribution: true,
  hasTraditionalIraContribution: true, hasQbi: true, hasInvestmentIncome: true,
  hasRetirementContributions: true,
  coveredSelf: true, coveredSpouse: false,
};

const facts = (over: Partial<ThresholdFacts> = {}): ThresholdFacts => ({
  year: 2026, params, household,
  agi: 300000, magiForIraDeduction: 300000, magiForStudentLoan: 300000,
  magiForRoth: 300000, magiForCredits: 300000,
  taxableIncomeBeforeQbi: 300000, amti: 300000,
  ...over,
});

describe("rangeFor", () => {
  it("returns the seeded Roth MFJ range", () => {
    expect(rangeFor("rothIra", 2026, params, "married_joint", household))
      .toEqual({ start: 242000, end: 252000 });
  });

  it("returns the statutory MFS range for Roth, ignoring seeded values", () => {
    expect(rangeFor("rothIra", 2026, params, "married_separate", household))
      .toEqual({ start: 0, end: 10000 });
  });

  it("returns the covered range when the contributor is covered", () => {
    expect(rangeFor("iraDeductCovered", 2026, params, "married_joint", household))
      .toEqual({ start: 129000, end: 149000 });
  });

  it("computes the CTC end from the household's child count, not a constant", () => {
    // $400,000 + (1 child x $2,200 / $50) x $1,000 = $444,000
    expect(rangeFor("ctc", 2026, params, "married_joint", { ...household, qualifyingChildren: 1 }))
      .toEqual({ start: 400000, end: 444000 });
    // Two children double the width.
    expect(rangeFor("ctc", 2026, params, "married_joint", { ...household, qualifyingChildren: 2 }))
      .toEqual({ start: 400000, end: 488000 });
  });

  it("returns not-applicable for CTC when no household is supplied", () => {
    expect(Number.isNaN(rangeFor("ctc", 2026, params, "married_joint").start)).toBe(true);
  });

  it("returns a point range for NIIT", () => {
    expect(rangeFor("niit", 2026, params, "married_joint", household))
      .toEqual({ start: 250000, end: null });
  });

  it("derives the AMT exemption end from the 50% OBBBA phaseout rate", () => {
    // start $1,000,000 + exemption $140,200 / 0.5 = $1,280,400
    expect(rangeFor("amtExemption", 2026, params, "married_joint", household))
      .toEqual({ start: 1000000, end: 1280400 });
  });

  it("uses the 25% pre-OBBBA rate for a 2025 year", () => {
    // Same exemption, half the phaseout rate → twice the width.
    expect(rangeFor("amtExemption", 2025, params, "married_joint", household))
      .toEqual({ start: 1000000, end: 1560800 });
  });

  it("returns the QBI threshold plus its phase-in range", () => {
    expect(rangeFor("qbi", 2026, params, "married_joint", household))
      .toEqual({ start: 403550, end: 553550 });
  });

  it("covers every declared item without throwing", () => {
    for (const item of THRESHOLD_ITEMS) {
      expect(() => rangeFor(item.id, 2026, params, "married_joint", household)).not.toThrow();
    }
  });

  it("returns not-applicable for AOTC when filing MFS — IRC 25A(g)(6)", () => {
    expect(isNaRange(rangeFor("aotc", 2026, params, "married_separate", household))).toBe(true);
  });

  it("still returns the MFJ and single AOTC ranges untouched by the MFS fix", () => {
    expect(rangeFor("aotc", 2026, params, "married_joint", household))
      .toEqual({ start: 160000, end: 180000 });
    expect(rangeFor("aotc", 2026, params, "single", household))
      .toEqual({ start: 80000, end: 90000 });
  });

  it("isNaRange distinguishes the NA sentinel from a real range", () => {
    expect(isNaRange(rangeFor("aotc", 2026, params, "married_separate", household))).toBe(true);
    expect(isNaRange(rangeFor("aotc", 2026, params, "married_joint", household))).toBe(false);
  });

  // The Saver's band was asserted NOWHERE. Swapping `start` and `end` — so the
  // row renders "$80,500 - $48,500" — left every test on this branch green,
  // because every status fixture sat entirely outside the band.
  it("returns the seeded Saver's Credit band — first tier ceiling to last", () => {
    expect(rangeFor("saversCredit", 2026, params, "married_joint", household))
      .toEqual({ start: 48500, end: 80500 });
  });
});

describe("statusFor", () => {
  it("is full below the range start", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 241999 }))).toBe("full");
  });

  it("is full exactly AT the range start", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 242000 }))).toBe("full");
  });

  it("is partial one dollar into the range", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 242001 }))).toBe("partial");
  });

  it("is out exactly AT the range end", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 252000 }))).toBe("out");
  });

  it("is out above the range end", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 300000 }))).toBe("out");
  });

  // The `partial` band was never entered on this branch — every Saver's
  // assertion sat below 48,500 or above 80,500 — so an inverted range could
  // not be detected by any of them.
  it("is partial inside the Saver's Credit band", () => {
    expect(statusFor("saversCredit", facts({ agi: 60000 }))).toBe("partial");
  });

  // `incomeFor` for the two IRA-deduction rows was structurally unpinnable: in
  // the only fixture that asserted them, EVERY income measure landed on the
  // same side of the band, so pointing the row at `magiForStudentLoan` (or
  // `agi`, or `taxableIncomeBeforeQbi`) changed nothing. Here every other
  // measure sits far outside 242,000-252,000, so only the right one yields
  // "partial".
  it("uses the IRA-deduction MAGI for the spousal row, not any other measure", () => {
    expect(statusFor("iraDeductSpousal", facts({
      household: { ...household, coveredSelf: false, coveredSpouse: true },
      magiForIraDeduction: 247000,
      magiForStudentLoan: 100000, magiForRoth: 100000,
      magiForCredits: 100000, agi: 100000, taxableIncomeBeforeQbi: 100000,
    }))).toBe("partial");
  });

  // These two household gates are `true` in every other fixture on the branch,
  // so dropping the flag from `applies()` left the whole suite green while a
  // household with no such account read "Full" instead of "N/A". Each MAGI
  // below is placed where the status would be "full" if the gate were gone —
  // that is what makes these discriminate na-vs-full rather than na-vs-out.
  it("is na when the household has no Roth contribution", () => {
    expect(statusFor("rothIra", facts({
      household: { ...household, hasRothContribution: false },
      magiForRoth: 241999,
    }))).toBe("na");
  });

  it("is na when the household has no student-loan interest", () => {
    expect(statusFor("studentLoanInterest", facts({
      household: { ...household, hasStudentLoanInterest: false },
      magiForStudentLoan: 100000,
    }))).toBe("na");
  });

  it("uses the student-loan MAGI, not the Roth MAGI", () => {
    expect(statusFor("studentLoanInterest", facts({
      magiForStudentLoan: 100000, magiForRoth: 900000,
    }))).toBe("full");
  });

  it("tests taxable income for QBI, not MAGI", () => {
    expect(statusFor("qbi", facts({
      taxableIncomeBeforeQbi: 400000, magiForCredits: 9_000_000,
    }))).toBe("full");
  });

  it("tests AMTI for the AMT exemption", () => {
    expect(statusFor("amtExemption", facts({ amti: 1100000 }))).toBe("partial");
  });

  it("is out above a point threshold (NIIT)", () => {
    expect(statusFor("niit", facts({ agi: 300000 }))).toBe("out");
    expect(statusFor("niit", facts({ agi: 200000 }))).toBe("full");
  });

  it("is na when the household has no qualifying children", () => {
    expect(statusFor("ctc", facts({
      household: { ...household, qualifyingChildren: 0, otherDependents: 0 },
    }))).toBe("na");
  });

  it("is na for the Saver's Credit from 2027 onward", () => {
    expect(statusFor("saversCredit", facts({ year: 2026, agi: 40000 }))).toBe("full");
    expect(statusFor("saversCredit", facts({ year: 2027, agi: 40000 }))).toBe("na");
  });

  it("is na for the Saver's Credit when the household contributed nothing", () => {
    // IRC 25B pays a percentage OF the contribution, so no contribution is no
    // credit at any AGI. Without this gate the Saver's row was the only
    // contribution-driven item with none — it read "Full" at a qualifying AGI
    // for a household `computeSaversCredit` pays $0, which is the same claim
    // the Roth and IRA-deduction rows are careful never to make.
    expect(statusFor("saversCredit", facts({
      year: 2026, agi: 40000,
      household: { ...household, hasRetirementContributions: false },
    }))).toBe("na");
  });

  it("is na when a required parameter was never seeded", () => {
    const bare = { ...params, rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null } } as TaxYearParameters;
    expect(statusFor("rothIra", facts({ params: bare }))).toBe("na");
  });

  it("is na for the student-loan deduction when filing MFS", () => {
    expect(statusFor("studentLoanInterest", facts({
      household: { ...household, filingStatus: "married_separate" },
    }))).toBe("na");
  });

  it("is na for AOTC when filing MFS — IRC 25A(g)(6)", () => {
    expect(statusFor("aotc", facts({
      household: { ...household, filingStatus: "married_separate" },
    }))).toBe("na");
  });
});

describe("rothIraAllowedContribution", () => {
  it("does not gate when the Roth phaseout params are unseeded — returns the full age-based limit", () => {
    const bare = {
      ...params,
      rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    } as TaxYearParameters;
    expect(rothIraAllowedContribution(9_000_000, 7000, 2026, bare, "married_joint")).toBe(7000);
  });

  it("is full exactly at the range start", () => {
    expect(rothIraAllowedContribution(242000, 7000, 2026, params, "married_joint")).toBe(7000);
  });

  it("is zero exactly at the range end", () => {
    expect(rothIraAllowedContribution(252000, 7000, 2026, params, "married_joint")).toBe(0);
  });

  it("rounds the reduced limit UP to the nearest $10, not down", () => {
    // start 242000, end 252000, width 10000; magi 33 into the range.
    // reduced = 7000 * (1 - 33/10000) = 6976.9 -> ceil to nearest $10 = 6980 (not 6970).
    expect(rothIraAllowedContribution(242033, 7000, 2026, params, "married_joint")).toBe(6980);
  });

  it("raises the reduced limit to the $200 floor at high MAGI inside the range", () => {
    // 100 short of the end: reduced = 7000 * (100/10000) = 70 -> floored up to 200.
    expect(rothIraAllowedContribution(251900, 7000, 2026, params, "married_joint")).toBe(200);
  });

  it("uses the statutory $0-$10,000 MFS range, not the seeded MFJ/single values", () => {
    // MFS range is 0-10000; magi 5000 is the midpoint -> half of 7000 = 3500.
    expect(rothIraAllowedContribution(5000, 7000, 2026, params, "married_separate")).toBe(3500);
  });

  it("caps the $200 floor at the age-based limit when that limit is itself under $200", () => {
    // Same 100-short-of-end position as the earlier floor test, but with an
    // ageBasedLimit of only $100 (a real state under IRC 408A(c)(2): a same-year
    // traditional-IRA contribution can shrink the Roth room below $200).
    // Un-capped floor math would raise this to $200 -- an excess contribution.
    // reduced = 100 * (100/10000) = 1 -> ceil to $10 = 10 -> floored to 200 ->
    // capped at the $100 ceiling.
    expect(rothIraAllowedContribution(251900, 100, 2026, params, "married_joint")).toBe(100);
  });

  it("phases out using the single MAGI range, not the MFJ range", () => {
    // Single range is 153000-168000 (width 15000); magi 160500 is the
    // midpoint -> half of 7000 = 3500. A transposed MFJ/single ternary would
    // read 160500 against the MFJ range (242000-252000) and return the full
    // $7000 instead.
    expect(rothIraAllowedContribution(160500, 7000, 2026, params, "single")).toBe(3500);
  });
});

describe("traditionalIraDeductibleAmount", () => {
  it("returns the full contribution when neither spouse is covered, regardless of MAGI — IRC 219(g)(1)", () => {
    expect(traditionalIraDeductibleAmount(9_000_000, 7000, 7000, false, false, 2026, params, "married_joint")).toBe(7000);
  });

  it("does not gate when the covered-MFJ params are unseeded", () => {
    const bare = {
      ...params,
      iraDeduct: { ...params.iraDeduct, coveredStartMfj: null, coveredEndMfj: null },
    } as TaxYearParameters;
    expect(traditionalIraDeductibleAmount(9_000_000, 7000, 7000, true, false, 2026, bare, "married_joint")).toBe(7000);
  });

  it("is full exactly at the covered-MFJ range start", () => {
    expect(traditionalIraDeductibleAmount(129000, 7000, 7000, true, false, 2026, params, "married_joint")).toBe(7000);
  });

  it("is zero exactly at the covered-MFJ range end", () => {
    expect(traditionalIraDeductibleAmount(149000, 7000, 7000, true, false, 2026, params, "married_joint")).toBe(0);
  });

  it("rounds the reduced covered-MFJ deduction UP to the nearest $10, not down", () => {
    // start 129000, end 149000, width 20000; magi 33 into the range.
    // reduced = 7000 * (1 - 33/20000) = 6988.45 -> ceil to nearest $10 = 6990 (not 6980).
    expect(traditionalIraDeductibleAmount(129033, 7000, 7000, true, false, 2026, params, "married_joint")).toBe(6990);
  });

  it("raises the reduced covered-MFJ deduction to the $200 floor at high MAGI inside the range", () => {
    // 100 short of the end: reduced = 7000 * (100/20000) = 35 -> floored up to 200.
    expect(traditionalIraDeductibleAmount(148900, 7000, 7000, true, false, 2026, params, "married_joint")).toBe(200);
  });

  it("reduces the §219(b) LIMIT, not the contribution — IRC 219(g)(2)(A)", () => {
    // The ONE case that discriminates the two formulations: a contribution
    // BELOW the annual limit. Covered-MFJ range 129000-149000 (width 20000);
    // magi 145000 is 80% through it, so 20% of the LIMIT survives:
    // 7000 * 0.2 = 1400, and the deduction is min(contribution, 1400) = 1400.
    // Reducing the CONTRIBUTION instead yields 6000 * 0.2 = 1200 — the engine's
    // former answer, which under-deducts whenever contribution < limit.
    // Every other case in this describe passes contribution === limit === 7000,
    // where the two formulations agree and nothing is pinned.
    expect(traditionalIraDeductibleAmount(145000, 6000, 7000, true, false, 2026, params, "married_joint")).toBe(1400);
  });

  it("caps at the §219(b)(1)(A) limit on EVERY path, so the range start is continuous", () => {
    // §219(b)(1)(A) caps the deductible amount at the annual limit regardless
    // of MAGI. Applying it only inside the phase-out band puts a cliff at the
    // range start: one dollar of MAGI cost 13,000 of deduction.
    //
    // Every other case in this describe passes contribution <= limit, where
    // the cap is invisible — which is why nothing pinned it.
    //
    // ONE `toEqual` rather than six `expect`s on purpose. Each of these is a
    // separate early return out of `traditionalIraDeductibleAmount`, and
    // separate assertions would stop at the first failure — crediting the
    // remaining paths with coverage that never actually ran.
    const over = 20_000;
    const at = (
      magi: number, coveredSelf: boolean, coveredSpouse: boolean,
      p: TaxYearParameters = params, status: FilingStatus = "married_joint",
    ) => traditionalIraDeductibleAmount(magi, over, 7000, coveredSelf, coveredSpouse, 2026, p, status);
    // Unseeded phase-out columns. §219(b)(1)(A) is NOT a phase-out, so it
    // still applies — and the limit basis comes from
    // `contribLimits.iraTradLimit`, a NOT NULL column seeded independently of
    // these nullable ones, so capping here is not capping by an unseeded
    // number.
    const bare = {
      ...params,
      iraDeduct: { ...params.iraDeduct, coveredStartMfj: null, coveredEndMfj: null },
    } as TaxYearParameters;
    expect({
      belowRange: at(100_000, true, false),
      atStart: at(129_000, true, false),
      oneDollarIn: at(129_001, true, false),
      // IRC 219(g)(1) never triggers: nobody is a covered participant.
      nobodyCovered: at(50_000, false, false),
      // Single filer — no spouse exists to trigger 219(g)(1), so the
      // phase-out is skipped on filing status alone.
      singleUncovered: at(50_000, false, true, params, "single"),
      unseeded: at(9_000_000, true, false, bare),
    }).toEqual({
      belowRange: 7000, atStart: 7000, oneDollarIn: 7000,
      nobodyCovered: 7000, singleUncovered: 7000, unseeded: 7000,
    });
  });

  it("gives a not-covered contributor with a covered spouse the spousal range, not the covered range", () => {
    // Spousal range is 242000-252000 (width 10000), entirely distinct from the
    // covered range (129000-149000). 247000 is the spousal range's midpoint ->
    // half of 7000 = 3500. A wrong implementation reading the covered range
    // would treat 247000 as past its end (149000) and return 0 instead.
    expect(traditionalIraDeductibleAmount(247000, 7000, 7000, false, true, 2026, params, "married_joint")).toBe(3500);
  });

  it("uses the narrow covered-MFS range for a covered self filing MFS", () => {
    // MFS statutory range is 0-10000; magi 5000 is the midpoint -> half of 7000 = 3500.
    expect(traditionalIraDeductibleAmount(5000, 7000, 7000, true, false, 2026, params, "married_separate")).toBe(3500);
  });

  it("routes a not-covered MFS filer with a covered spouse to the SAME narrow MFS range, not the MFJ-only spousal range", () => {
    // rangeFor("iraDeductSpousal", ...) returns NA for MFS -- genuinely
    // inapplicable (IRC 219(g)(7)'s spousal exception is MFJ-only), not
    // unseeded. A wrong implementation that read that NA as "unseeded, don't
    // gate" would return the full $7000 here; the correct answer routes
    // through the covered-MFS range (0-10000) and phases it to 3500 at magi 5000.
    expect(traditionalIraDeductibleAmount(5000, 7000, 7000, false, true, 2026, params, "married_separate")).toBe(3500);
  });

  it("gives a not-covered single filer the full contribution — no spouse exists to be covered", () => {
    // rangeFor("iraDeductSpousal", ...) would also return NA for "single",
    // but for the unrelated reason that the item is MFJ-only, not because
    // it's unseeded. This must be decided on filing status, not inferred
    // from that NA -- pinned here so a later change can't silently start
    // reading a seeded spousal range for a filer who has no spouse.
    expect(traditionalIraDeductibleAmount(9_000_000, 7000, 7000, false, true, 2026, params, "single")).toBe(7000);
  });

  it("never deducts more than was contributed when the reduced limit exceeds it", () => {
    // Same 100-short-of-end covered-MFJ position as the earlier floor test,
    // but with a $100 contribution.
    // reduced LIMIT = 7000 * (100/20000) = 35 -> ceil to $10 = 40 -> raised to
    // the $200 floor. The deduction is then min(contribution, 200) = $100 --
    // the §219(a) step, not a cap inside `roundReducedLimit`. Dropping that
    // final min would deduct $200 against a $100 contribution.
    expect(traditionalIraDeductibleAmount(148900, 100, 7000, true, false, 2026, params, "married_joint")).toBe(100);
  });

  it("phases out using the covered-single MAGI range, not the covered-MFJ range", () => {
    // Covered-single range is 81000-91000 (width 10000); magi 86000 is the
    // midpoint -> half of 7000 = 3500. A transposed MFJ/single ternary would
    // read 86000 against the MFJ range (129000-149000) and return the full
    // $7000 instead.
    expect(traditionalIraDeductibleAmount(86000, 7000, 7000, true, false, 2026, params, "single")).toBe(3500);
  });
});

describe("studentLoanInterestDeduction", () => {
  it("returns $0 for MFS regardless of interest paid or MAGI — IRC 221(e)(2)", () => {
    expect(studentLoanInterestDeduction(999_999, 0, 2026, params, "married_separate")).toBe(0);
  });

  it("does not gate when the MFJ range params are unseeded — returns the capped amount", () => {
    const bare = {
      ...params,
      studentLoan: { ...params.studentLoan, startMfj: null, endMfj: null },
    } as TaxYearParameters;
    expect(studentLoanInterestDeduction(3000, 9_000_000, 2026, bare, "married_joint")).toBe(2500);
  });

  // PREMISE CHANGED. This test previously read "does not cap the deduction when
  // maxDeduction is null" and expected the full 5,000 — i.e. a null cap meant NO
  // cap. It now resolves to IRC 221(b)(1)'s statutory $2,500. See the fallback's
  // comment in thresholds.ts for why this one field narrows the module's
  // standing "unseeded -> don't gate" rule.
  it("falls back to the statutory $2,500 cap when maxDeduction is unseeded", () => {
    const uncapped = {
      ...params,
      studentLoan: { ...params.studentLoan, maxDeduction: null },
    } as TaxYearParameters;
    // magi 170000 is below the MFJ range start (175000) — no phase-out, so this
    // isolates the cap. Still never $0: a null cap must not zero the deduction.
    expect(studentLoanInterestDeduction(5000, 170000, 2026, uncapped, "married_joint")).toBe(2500);
  });

  it("prefers a seeded maxDeduction over the statutory fallback", () => {
    // A seeded 3,000 must win. Hardcoding 2500 at the Math.min, or applying
    // `?? 2500` to the RESULT rather than to the cap, would return 2500 here.
    const seeded = {
      ...params,
      studentLoan: { ...params.studentLoan, maxDeduction: 3000 },
    } as TaxYearParameters;
    expect(studentLoanInterestDeduction(5000, 170000, 2026, seeded, "married_joint")).toBe(3000);
  });

  it("caps at the statutory $2,500 but does NOT phase out when cap AND range are unseeded", () => {
    // Exactly the shape of the DB today: every studentLoan column NULL. The two
    // halves resolve differently ON PURPOSE — the cap has a fixed statutory
    // constant to fall back to, the inflation-indexed range bounds do not.
    const bare = {
      ...params,
      studentLoan: {
        maxDeduction: null, startMfj: null, endMfj: null,
        startSingle: null, endSingle: null,
      },
    } as TaxYearParameters;
    // ~$13,000 of interest (a $200k med-school balance at 6.5%) at a MAGI far
    // past any real phase-out: capped to 2,500 — not the full 13,000, and not
    // gated to 0.
    expect(studentLoanInterestDeduction(13000, 9_000_000, 2026, bare, "married_joint")).toBe(2500);
  });

  it("is the full capped amount exactly at the range start", () => {
    expect(studentLoanInterestDeduction(2500, 175000, 2026, params, "married_joint")).toBe(2500);
  });

  it("is zero exactly at the range end", () => {
    expect(studentLoanInterestDeduction(2500, 205000, 2026, params, "married_joint")).toBe(0);
  });

  it("phases linearly with no $10/$200 rounding", () => {
    // start 175000, end 205000, width 30000; magi 10000 into the range ->
    // fraction 1/3 -> capped 2500 * (2/3) = 1666.6667, not rounded to a $10 step.
    expect(studentLoanInterestDeduction(2500, 185000, 2026, params, "married_joint"))
      .toBeCloseTo(1666.6667, 4);
  });

  it("caps interest at maxDeduction BEFORE applying the phase-out", () => {
    // interest paid ($4000) exceeds the $2500 cap; cap first, then phase.
    // capped 2500 at magi 185000 (1/3 into the range) -> 2500 * (2/3) = 1666.6667.
    // If the cap were applied after (or not at all), this would be 2666.6667.
    expect(studentLoanInterestDeduction(4000, 185000, 2026, params, "married_joint"))
      .toBeCloseTo(1666.6667, 4);
  });

  it("phases out using the single MAGI range, not the MFJ range", () => {
    // Single range is 85000-100000 (width 15000); magi 92500 is the midpoint
    // -> half of the $2500 cap = 1250. A transposed MFJ/single ternary would
    // read 92500 against the MFJ range (175000-205000) and return the full
    // $2500 instead.
    expect(studentLoanInterestDeduction(2500, 92500, 2026, params, "single")).toBe(1250);
  });
});
