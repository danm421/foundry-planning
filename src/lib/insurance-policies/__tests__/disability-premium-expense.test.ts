import { describe, it, expect } from "vitest";
import {
  synthesizeDisabilityPremiums,
  withSynthesizedDisabilityPremiums,
} from "../disability-premium-expense";
import { withSynthesizedPremiums } from "../premium-expense";
import { computeExpenses } from "@/engine/expenses";
import { buildClientData, basePlanSettings, baseClient } from "@/engine/__tests__/fixtures";
import type { DisabilityPolicy } from "@/engine/types";

const base: DisabilityPolicy = {
  id: "dp-1",
  name: "Individual LTD",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: null,
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: null,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: false,
  colaRate: 0,
  annualPremium: 2400,
  premiumPayer: "insured",
};

describe("synthesizeDisabilityPremiums", () => {
  it("bills an insured-paid premium from plan start to the insured's retirement year", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({ disabilityPolicies: [base] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].annualAmount).toBe(2400);
    expect(out[0].type).toBe("insurance");
    expect(out[0].startYear).toBe(basePlanSettings.planStartYear);
    // baseClient: DOB 1970, retirementAge 65 => retires 2035.
    expect(out[0].endYear).toBe(2035);
  });

  it("bills nothing when the employer pays", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({ disabilityPolicies: [{ ...base, premiumPayer: "employer" }] }),
    );
    expect(out).toEqual([]);
  });

  it("bills nothing when the premium is zero", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({ disabilityPolicies: [{ ...base, annualPremium: 0 }] }),
    );
    expect(out).toEqual([]);
  });

  it("stops the premium the year before disability starts — waiver of premium", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [base],
        planSettings: {
          ...basePlanSettings,
          disabilityEvent: { person: "client", startYear: 2030 },
        },
      }),
    );
    expect(out[0].endYear).toBe(2029);
  });

  it("does not apply waiver when the OTHER person is the one disabled", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [base],
        planSettings: {
          ...basePlanSettings,
          disabilityEvent: { person: "spouse", startYear: 2030 },
        },
      }),
    );
    expect(out[0].endYear).toBe(2035);
  });

  it("bills a spouse-insured policy through the SPOUSE's retirement year, not the client's", () => {
    // baseClient: spouseDob 1972-06-15, spouseRetirementAge 65 => spouse retires 2037.
    // Client retires 2035 (see first test). If the resolver ever used the
    // client's retirement year for a spouse-insured policy, this would wrongly
    // assert 2035 and the bug would slip through.
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [{ ...base, insured: "spouse" }],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].endYear).toBe(2037);
  });

  it("bills the last year before disability and NOTHING in the disability year, observed as a real amount", () => {
    // The only assertion in this suite that reads a BILLED AMOUNT rather than
    // the row's own `endYear` field. It is what pins `endYear` as INCLUSIVE —
    // i.e. that 2029 is the last billed year, not the first unbilled one.
    // `computeExpenses` gates on `year <= endYear` via `endInclusionAndFactor`.
    const tree = buildClientData({
      disabilityPolicies: [base],
      planSettings: {
        ...basePlanSettings,
        disabilityEvent: { person: "client", startYear: 2030 },
      },
    });
    const rows = synthesizeDisabilityPremiums(tree);
    const billed = (year: number) => computeExpenses(rows, year, tree.client).insurance;
    expect(billed(2029)).toBeGreaterThan(0);
    expect(billed(2030)).toBe(0);
  });

  describe("unresolvable retirement year — no row at all", () => {
    // Global constraint: "Missing DOB fails loudly. An age-based benefit period
    // that cannot resolve pays NOTHING and surfaces a warning. No silent
    // fallback to plan end, to zero, or to the client's DOB." A policy that
    // cannot resolve is inert on BOTH sides — it pays no benefit (Task 4) and
    // must bill no premium. Surfacing the warning is the UI's job, via
    // `resolveCoverage`'s `unresolved`.
    it("emits no premium row for a spouse-insured policy with no spouseDob", () => {
      const out = synthesizeDisabilityPremiums(
        buildClientData({
          client: { ...baseClient, spouseDob: undefined },
          disabilityPolicies: [{ ...base, insured: "spouse" }],
        }),
      );
      expect(out).toEqual([]);
    });

    it("emits no premium row for a spouse-insured policy with no spouseRetirementAge", () => {
      const out = synthesizeDisabilityPremiums(
        buildClientData({
          client: { ...baseClient, spouseRetirementAge: undefined },
          disabilityPolicies: [{ ...base, insured: "spouse" }],
        }),
      );
      expect(out).toEqual([]);
    });

    it("emits no premium row when the DOB is malformed and parses to NaN", () => {
      // NaN comparisons are always false, so an unguarded parse escapes the
      // `resolvedEnd < planStartYear` guard and emits a row with endYear: NaN
      // that silently never bills. Mirrors the `Number.isFinite` guard in
      // src/engine/retirement-proration.ts.
      const out = synthesizeDisabilityPremiums(
        buildClientData({
          client: { ...baseClient, dateOfBirth: "not-a-date" },
          disabilityPolicies: [base],
        }),
      );
      expect(out).toEqual([]);
    });
  });
});

describe("withSynthesizedDisabilityPremiums", () => {
  const ROW_ID = "disability-premium-dp-1";

  it('tags the row `source: "policy"` so the editable surfaces hide it', () => {
    // Four surfaces gate on `source !== "policy"`: the portal writability check
    // (portal-flow-writable.ts), the manual income/expense editor, the
    // onboarding cash-flow step, and the household-map edit drawer. Without the
    // tag the portal offers edit/delete on a row with no DB id and the PUT 500s.
    const out = synthesizeDisabilityPremiums(buildClientData({ disabilityPolicies: [base] }));
    expect(out[0].source).toBe("policy");
  });

  it("ORDERING INVARIANT: the disability synthesizer must run AFTER withSynthesizedPremiums", () => {
    // `withSynthesizedPremiums` strips EVERY `source: "policy"` expense and
    // re-derives only from life-insurance ACCOUNTS — it knows nothing about
    // disability policies. Run it after us and the disability premium is gone
    // for good, silently. All THREE non-test call sites honour this ordering:
    // load-client-data.ts (disability outermost), scenario/loader.ts (disability
    // after the life-insurance links) and solver/apply-mutations.ts (which
    // never calls withSynthesizedPremiums at all).
    //
    // ⚠️ What this test does NOT do is watch the call sites. It composes the two
    // functions here and pins both directions; it cannot see a call site, and it
    // proved that when the third one was added and this file stayed 13/13 green
    // without a character changing. A new call site placed on the wrong side of
    // `withSynthesizedPremiums` deletes the premium row silently and NOTHING
    // here goes red. Call-site ordering is reviewed by hand, against the
    // ORDERING INVARIANT doc comment on `synthesizeDisabilityPremiums`.
    const tree = buildClientData({ disabilityPolicies: [base], expenses: [] });

    const right = withSynthesizedDisabilityPremiums(withSynthesizedPremiums(tree));
    expect(right.expenses.some((e) => e.id === ROW_ID)).toBe(true);

    const wrong = withSynthesizedPremiums(withSynthesizedDisabilityPremiums(tree));
    expect(wrong.expenses.some((e) => e.id === ROW_ID)).toBe(false);
  });

  it("is idempotent — re-running does not duplicate the row", () => {
    const tree = buildClientData({ disabilityPolicies: [base], expenses: [] });
    const once = withSynthesizedDisabilityPremiums(tree);
    const twice = withSynthesizedDisabilityPremiums(once);
    expect(twice.expenses.filter((e) => e.id === ROW_ID)).toHaveLength(1);
  });
});
