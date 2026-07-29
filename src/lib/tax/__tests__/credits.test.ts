import { describe, it, expect } from "vitest";
import { computeCredits, aotcSurvivingFraction } from "../credits";
import type { CreditsInput } from "../credits";
import type { TaxYearParameters } from "../types";

// Minimal TaxYearParameters fixture — credits.ts only reads `.ctc` and
// `.saversCredit`. Deliberately has NO `.year` field: R8 requires the Saver's
// sunset to key off `input.year`, never `params.year`; omitting it here means
// a mutant that reads `params.year` instead reads `undefined`, which can never
// exceed `saversCreditLastYear`, so the 2027 test below would fail loudly.
const params = {
  ctc: { perChild: 2000, refundableMax: 1700, odcPerDependent: 500 },
  saversCredit: {
    mfj: [
      { rate: 0.5, agiCeiling: 48000 },
      { rate: 0.2, agiCeiling: 52000 },
      { rate: 0.1, agiCeiling: 80000 },
    ],
    single: [
      { rate: 0.5, agiCeiling: 24000 },
      { rate: 0.2, agiCeiling: 26000 },
      { rate: 0.1, agiCeiling: 40000 },
    ],
    hoh: [
      { rate: 0.5, agiCeiling: 36000 },
      { rate: 0.2, agiCeiling: 39000 },
      { rate: 0.1, agiCeiling: 60000 },
    ],
  },
} as unknown as TaxYearParameters;

const baseInput = (over: Partial<CreditsInput> = {}): CreditsInput => ({
  year: 2026,
  filingStatus: "married_joint",
  params,
  magi: 100000,
  agi: 100000,
  earnedIncome: 150000,
  taxBeforeCredits: 50000,
  qualifyingChildren: 0,
  otherDependents: 0,
  aotcStudents: [],
  retirementContributions: { client: 0, spouse: 0 },
  ...over,
});

describe("computeCredits — CTC/ODC phase-down", () => {
  it("costs exactly $50 for $1 over the CTC threshold — proves ceil, not floor", () => {
    // Mutant killed: Math.floor in place of Math.ceil for the reduction step.
    // floor(1/1000)=0 -> reduction 0 -> at 400001 the credit would stay 2000.
    const at = computeCredits(baseInput({ qualifyingChildren: 1, magi: 400000, taxBeforeCredits: 100000 }));
    const over = computeCredits(baseInput({ qualifyingChildren: 1, magi: 400001, taxBeforeCredits: 100000 }));
    expect(at.byCredit.ctcNonrefundable).toBe(2000);
    expect(over.byCredit.ctcNonrefundable).toBe(1950);
  });

  it("uses the $200,000 'other' threshold, not $400,000 MFJ, for a single filer", () => {
    // Mutant killed: always using the MFJ threshold regardless of filing status.
    const result = computeCredits(baseInput({
      filingStatus: "single", qualifyingChildren: 1, magi: 200001, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.ctcNonrefundable).toBe(1950);
  });

  it("allocates the phase-out reduction to ODC first, leaving CTC untouched when the reduction is small (R5)", () => {
    // gross = 1*2000 (ctc) + 4*500 (odc) = 4000; excess = 21; reduction = ceil(21/1000)*50 = 50.
    // Mutant killed: allocating the reduction to CTC first instead of ODC first
    // would give ctcNonrefundable 1950 and odc 2000 — the reverse of this assertion.
    const result = computeCredits(baseInput({
      qualifyingChildren: 1, otherDependents: 4, magi: 400021, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.odc).toBe(1950);
    expect(result.byCredit.ctcNonrefundable).toBe(2000);
  });

  it("still pays the full CTC when only odcPerDependent is unseeded (R2 independence)", () => {
    // Mutant killed: copying rangeFor's `perChild == null || odc == null -> 0`
    // conjunction, which would zero the CTC too even though perChild IS seeded.
    const partiallyUnseeded = {
      ...params, ctc: { perChild: 2000, refundableMax: 1700, odcPerDependent: null },
    } as unknown as TaxYearParameters;
    const result = computeCredits(baseInput({
      params: partiallyUnseeded, qualifyingChildren: 2, otherDependents: 3, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.ctcNonrefundable).toBe(4000);
    expect(result.byCredit.odc).toBe(0);
  });

  it("still pays the full ODC when only perChild is unseeded (R2 independence, other direction)", () => {
    const partiallyUnseeded = {
      ...params, ctc: { perChild: null, refundableMax: 1700, odcPerDependent: 500 },
    } as unknown as TaxYearParameters;
    const result = computeCredits(baseInput({
      params: partiallyUnseeded, qualifyingChildren: 2, otherDependents: 3, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.odc).toBe(1500);
    expect(result.byCredit.ctcNonrefundable).toBe(0);
  });

  it("does not manufacture a refundable ACTC out of ODC amounts when perChild is unseeded and CTC itself is zero (R6 CORRECTION)", () => {
    // Mutant killed: reverting `unused` to the unclamped aggregate
    // (`afterPhaseout - (odcUsed + ctcNonrefundableUsed)`, no ctcAfter clamp)
    // reintroduces this exact defect. With perChild null, ctcGross/ctcAfter
    // are both 0, so the CTC earns nothing — but the unclamped aggregate
    // leftover is driven entirely by ODC (1,500 = 3 * 500), which then flows
    // out as a $1,500 *refundable* credit despite ODC never being refundable
    // and the household's CTC being exactly $0. Exact repro from the review.
    const perChildUnseeded = {
      ...params, ctc: { perChild: null, refundableMax: 1700, odcPerDependent: 500 },
    } as unknown as TaxYearParameters;
    const result = computeCredits(baseInput({
      params: perChildUnseeded, qualifyingChildren: 2, otherDependents: 3,
      taxBeforeCredits: 0, earnedIncome: 150000,
    }));
    expect(result.byCredit.ctcRefundable).toBe(0);
  });

  it("yields 0, never NaN, when both ctc.perChild and odcPerDependent are unseeded", () => {
    // Mutant killed: dropping the `?? 0` fallback, producing `null * n` = NaN.
    const unseeded = {
      ...params, ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    } as unknown as TaxYearParameters;
    const result = computeCredits(baseInput({
      params: unseeded, qualifyingChildren: 2, otherDependents: 1, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.ctcNonrefundable).toBe(0);
    expect(result.byCredit.odc).toBe(0);
    expect(result.byCredit.ctcRefundable).toBe(0);
    expect(Number.isNaN(result.nonrefundable)).toBe(false);
    expect(Number.isNaN(result.refundable)).toBe(false);
  });

  it("denies AOTC to an MFS filer while still paying CTC in the SAME fixture (R3, both directions)", () => {
    // Mutant killed (AOTC half): dropping the MFS check entirely, which would
    // let an MFS filer draw the full AOTC. Mutant killed (CTC half): a stray
    // MFS denial bleeding into the CTC/ODC path, which IRC 24 does not have.
    const result = computeCredits(baseInput({
      filingStatus: "married_separate", qualifyingChildren: 1, magi: 100000,
      taxBeforeCredits: 100000, aotcStudents: [{ qualifiedExpenses: 4000 }],
    }));
    expect(result.byCredit.aotcNonrefundable).toBe(0);
    expect(result.byCredit.aotcRefundable).toBe(0);
    expect(result.byCredit.ctcNonrefundable).toBe(2000);
  });
});

describe("computeCredits — ACTC (Schedule 8812 line 16a)", () => {
  it("pays ACTC even when tax before credits is zero", () => {
    // Mutant killed: gating the refundable ACTC on remainingTax instead of on
    // the aggregate-leftover formula — would zero this out incorrectly.
    const result = computeCredits(baseInput({
      qualifyingChildren: 1, taxBeforeCredits: 0, earnedIncome: 60000,
    }));
    // afterPhaseout = 2000 (no phaseout at magi 100000); unused = 2000 - 0 = 2000;
    // cap = 1 * 1700 = 1700; earned-income floor = 0.15*(60000-2500) = 8625 (not binding).
    expect(result.byCredit.ctcRefundable).toBe(1700);
  });

  it("pays refundable AOTC even when tax before credits is zero", () => {
    const result = computeCredits(baseInput({
      taxBeforeCredits: 0, aotcStudents: [{ qualifiedExpenses: 4000 }],
    }));
    // raw = min(2000,4000) + 0.25*min(2000,2000) = 2000+500 = 2500 (capped, no phaseout);
    // refundable = min(0.4*2500, 1000) = 1000, unaffected by remainingTax.
    expect(result.byCredit.aotcRefundable).toBe(1000);
    expect(result.nonrefundable).toBe(0);
  });

  it("caps ACTC at 15% of earned income over the $2,500 floor for a low earner", () => {
    // Mutant killed: dropping the earned-income term from the min(), or using
    // the wrong floor/rate constant.
    const result = computeCredits(baseInput({
      qualifyingChildren: 1, taxBeforeCredits: 0, earnedIncome: 10000,
    }));
    // unused=2000, cap=1700, earned-income limit = 0.15*(10000-2500)=1125 (binds).
    expect(result.byCredit.ctcRefundable).toBe(1125);
  });

  it("consumes nonrefundable credits in order Saver's -> AOTC -> ODC -> CTC (R4)", () => {
    // Mutant killed: swapping Saver's and AOTC's processing order. Saver's
    // pool is 1,000 (0.5*2000); AOTC-nonrefundable pool is 1,500. At
    // taxBeforeCredits 2,000, the CORRECT order pays Saver's in full (1,000)
    // and leaves only 1,000 of the remaining 1,000 tax for AOTC (partial:
    // 1,000 of its 1,500 pool). A swapped order would instead pay AOTC in
    // full (1,500) and leave only 500 for Saver's — savers 500 / aotc 1,500,
    // the reverse split of what's asserted below. (The previous fixture used
    // taxBeforeCredits 2,700, which covers 1000+1500=2,500 in full regardless
    // of order, so a Saver's<->AOTC swap changed no assertion.)
    const result = computeCredits(baseInput({
      retirementContributions: { client: 2000, spouse: 0 }, agi: 30000,
      aotcStudents: [{ qualifiedExpenses: 4000 }],
      qualifyingChildren: 1, otherDependents: 1,
      taxBeforeCredits: 2000,
    }));
    expect(result.byCredit.saversCredit).toBe(1000);
    expect(result.byCredit.aotcNonrefundable).toBe(1000);
    expect(result.byCredit.odc).toBe(0);
    expect(result.byCredit.ctcNonrefundable).toBe(0);
  });
});

describe("computeCredits — AOTC mechanics (IRC 25A)", () => {
  it("yields $1,500 for $1,500 of expenses, not the $2,500 max", () => {
    // Mutant killed: returning the flat $2,500 max regardless of actual expenses.
    const result = computeCredits(baseInput({
      taxBeforeCredits: 100000, aotcStudents: [{ qualifiedExpenses: 1500 }],
    }));
    expect(result.byCredit.aotcNonrefundable + result.byCredit.aotcRefundable).toBe(1500);
  });

  it("applies the 25% partial rate to the second $2,000 of expenses", () => {
    // Mutant killed: dropping the two-tier split (e.g. using min(2500, expenses) directly).
    const result = computeCredits(baseInput({
      taxBeforeCredits: 100000, aotcStudents: [{ qualifiedExpenses: 3000 }],
    }));
    // raw = min(2000,3000) + 0.25*min(2000, 1000) = 2000 + 250 = 2250
    expect(result.byCredit.aotcNonrefundable + result.byCredit.aotcRefundable).toBe(2250);
  });

  it("splits phased AOTC 60% nonrefundable / 40% refundable at the exact MFJ midpoint (R10 float discipline)", () => {
    // 170,000 is the exact MFJ midpoint of the 160k-180k window: fraction is
    // exactly 0.5 in binary64, so an exact toBe is safe here (per R10).
    const result = computeCredits(baseInput({
      magi: 170000, taxBeforeCredits: 100000, aotcStudents: [{ qualifiedExpenses: 4000 }],
    }));
    // raw=2500 (capped); phased = 2500*0.5 = 1250; refundable=min(500,1000)=500; nonref=750.
    expect(result.byCredit.aotcRefundable).toBe(500);
    expect(result.byCredit.aotcNonrefundable).toBe(750);
  });

  it("phases at the exact 0.75-surviving-fraction MFJ point (165,000)", () => {
    const result = computeCredits(baseInput({
      magi: 165000, taxBeforeCredits: 100000, aotcStudents: [{ qualifiedExpenses: 4000 }],
    }));
    // fraction = (180000-165000)/20000 = 0.75; phased = 2500*0.75 = 1875;
    // refundable = min(750,1000) = 750; nonrefundable = 1125.
    expect(result.byCredit.aotcRefundable).toBe(750);
    expect(result.byCredit.aotcNonrefundable).toBe(1125);
  });

  it("phases at the exact non-MFJ midpoint (85,000, single filer)", () => {
    const result = computeCredits(baseInput({
      filingStatus: "single", magi: 85000, taxBeforeCredits: 100000,
      aotcStudents: [{ qualifiedExpenses: 4000 }],
    }));
    // window 80,000-90,000; fraction = 0.5; phased=1250; refundable=500; nonref=750.
    expect(result.byCredit.aotcRefundable).toBe(500);
    expect(result.byCredit.aotcNonrefundable).toBe(750);
  });

  it("fully phases out AOTC at exactly the window end", () => {
    // Mutant killed: an off-by-one in the clamp (e.g. `< 1` instead of `<= 1`)
    // that leaves a sliver of credit exactly at the boundary.
    const result = computeCredits(baseInput({
      magi: 180000, taxBeforeCredits: 100000, aotcStudents: [{ qualifiedExpenses: 4000 }],
    }));
    expect(result.byCredit.aotcRefundable).toBe(0);
    expect(result.byCredit.aotcNonrefundable).toBe(0);
  });
});

describe("computeCredits — Saver's Credit (IRC 25B)", () => {
  it("returns 0 in 2027 (SECURE 2.0 sunset) and non-zero in 2026 at the same AGI (R8)", () => {
    // Mutant killed: reading params.year (absent in this fixture -> undefined,
    // never > saversCreditLastYear) instead of input.year.
    const contrib = { retirementContributions: { client: 2000, spouse: 0 }, agi: 30000, taxBeforeCredits: 100000 };
    const in2026 = computeCredits(baseInput({ year: 2026, ...contrib }));
    const in2027 = computeCredits(baseInput({ year: 2027, ...contrib }));
    expect(in2026.byCredit.saversCredit).toBe(1000);
    expect(in2027.byCredit.saversCredit).toBe(0);
  });

  it("returns 0 when AGI exceeds every tier ceiling", () => {
    // Mutant killed: falling back to the LAST tier's rate instead of 0 when no
    // tier's ceiling covers the AGI.
    const result = computeCredits(baseInput({
      agi: 90000, retirementContributions: { client: 2000, spouse: 2000 }, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.saversCredit).toBe(0);
  });

  it("returns 0 when the applicable tier array is empty (unseeded)", () => {
    const unseeded = { ...params, saversCredit: { mfj: [], single: [], hoh: [] } } as unknown as TaxYearParameters;
    const result = computeCredits(baseInput({
      params: unseeded, retirementContributions: { client: 2000, spouse: 0 }, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.saversCredit).toBe(0);
  });

  it("caps the contribution at $2,000 PER PERSON, not per household (R9)", () => {
    // Mutant killed: capping the sum of both contributions at $2,000 before
    // applying the rate (would give 1000 instead of 2000).
    const result = computeCredits(baseInput({
      agi: 30000, retirementContributions: { client: 5000, spouse: 5000 }, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.saversCredit).toBe(2000);
  });

  it("sums both retirement-contribution entries regardless of filing status (R9 — filtering is the caller's job)", () => {
    // Mutant killed: adding a filingStatus guard that zeroes the spouse figure
    // for a single filer.
    const result = computeCredits(baseInput({
      filingStatus: "single", agi: 20000,
      retirementContributions: { client: 1000, spouse: 1000 }, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.saversCredit).toBe(1000); // 0.5 * (1000 + 1000)
  });

  it("uses the head-of-household tier table for HOH filers (R9 routing)", () => {
    // Mutant killed: routing HOH to the single table instead of hoh. At AGI
    // 35,000 the HOH table's 0.5-rate tier (ceiling 36,000) applies, giving
    // 1,000; the single table (24,000/26,000/40,000) would instead land in
    // its 0.1-rate tier (ceiling 40,000), giving 200.
    const result = computeCredits(baseInput({
      filingStatus: "head_of_household", agi: 35000,
      retirementContributions: { client: 2000, spouse: 0 }, taxBeforeCredits: 100000,
    }));
    expect(result.byCredit.saversCredit).toBe(1000);
  });
});

describe("computeCredits — byCredit structural invariants (R4)", () => {
  // taxBeforeCredits: 5000 is chosen so all four nonrefundable credits are
  // non-zero — Saver's (pool 1,500, fully paid), AOTC-nonrefundable (pool
  // 1,500, fully paid), ODC (pool 500, fully paid), CTC-nonrefundable (pool
  // 2,000, partially paid — 1,500 of the remaining 1,500 tax). A smaller
  // taxBeforeCredits (e.g. the previous 3,000) left ODC and CTC-nonrefundable
  // both at 0, making the invariant vacuous for those two terms: a mutant
  // that dropped either from the final sum still passed.
  const richFixture = () => computeCredits(baseInput({
    qualifyingChildren: 1, otherDependents: 1, taxBeforeCredits: 5000,
    aotcStudents: [{ qualifiedExpenses: 4000 }],
    retirementContributions: { client: 2000, spouse: 1000 }, agi: 30000,
  }));

  it("nonrefundable equals the sum of the four nonrefundable byCredit fields, all four non-zero", () => {
    // Mutant killed: a typo in the final `nonrefundable:` sum (e.g. dropping a
    // term, or double-counting one) that diverges from the reported
    // breakdown. The total is also pinned against a value computed BY HAND
    // from the fixture (not read off a test run), so a mutant that corrupts
    // BOTH the sum and every individual byCredit field identically the same
    // way still cannot hide: it would have to reproduce 5000 exactly.
    const result = richFixture();
    expect(result.byCredit.saversCredit).toBe(1500); // 0.5 * (2000 + 1000)
    expect(result.byCredit.aotcNonrefundable).toBe(1500); // 60% of the $2,500 capped, unphased credit
    expect(result.byCredit.odc).toBe(500); // 1 * 500, no phase-out at magi 100,000
    expect(result.byCredit.ctcNonrefundable).toBe(1500); // pool 2,000, only 1,500 of tax left after the other three
    expect(result.nonrefundable).toBe(5000);
  });

  it("refundable equals the sum of the two refundable byCredit fields", () => {
    // Mutant killed: a typo in the final `refundable:` sum, e.g. summing
    // ctcNonrefundable instead of ctcRefundable. Both terms are hand-computed
    // independently, not read off `result.byCredit`.
    const result = richFixture();
    expect(result.byCredit.aotcRefundable).toBe(1000); // 40% of the $2,500 capped, unphased credit
    expect(result.byCredit.ctcRefundable).toBe(500); // afterPhaseout 2500 - used 2000 = 500 unused, under both caps
    expect(result.refundable).toBe(1500);
  });
});

// ── The phase-out fraction, exported for the IRC 25A(b)(2)(C) counter ───────

describe("aotcSurvivingFraction", () => {
  // AOTC ranges are STATUTORY_FIXED, not seeded: MFJ 160,000-180,000,
  // everyone else 80,000-90,000. The `params` fixture never supplies them.
  const mfj = (magi: number) => aotcSurvivingFraction(2026, params, "married_joint", magi);

  it("is 1 below the range and 0 at or above its top", () => {
    expect(mfj(150_000)).toBe(1);
    expect(mfj(160_000)).toBe(1);
    // Exactly AT the ceiling the credit is gone — the boundary that decides
    // whether the year burns one of the student's four.
    expect(mfj(180_000)).toBe(0);
    expect(mfj(430_000)).toBe(0);
  });

  it("is linear inside the range", () => {
    // (180,000 - 175,625) / 20,000 = 0.21875 — the golden projection's figure.
    expect(mfj(175_625)).toBe(0.21875);
    expect(mfj(170_000)).toBe(0.5);
  });

  it("is 0 for MFS at ANY income — IRC 25A(g)(6) denies the credit outright", () => {
    // Must be decided on filing status, not inferred from rangeFor's NA
    // sentinel, which elsewhere means "not seeded yet". A filer well below
    // every threshold still gets nothing.
    expect(aotcSurvivingFraction(2026, params, "married_separate", 0)).toBe(0);
    expect(aotcSurvivingFraction(2026, params, "married_separate", 50_000)).toBe(0);
    // ...while the same income single is fully in.
    expect(aotcSurvivingFraction(2026, params, "single", 50_000)).toBe(1);
  });

  it("uses the narrower non-MFJ range", () => {
    // Single 80,000-90,000: 85,000 is the midpoint. Under the MFJ range the
    // same MAGI would survive in full, so a transposed ternary shows up here.
    expect(aotcSurvivingFraction(2026, params, "single", 85_000)).toBe(0.5);
    expect(mfj(85_000)).toBe(1);
  });
});
