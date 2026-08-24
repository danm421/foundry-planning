/**
 * RULING E — a waived premium that kept billing inside the solver.
 *
 * `synthesizeDisabilityPremiums` implements waiver of premium by reading
 * `planSettings.disabilityEvent` and capping the row at `startYear - 1`. It runs
 * at exactly two LOAD-TIME sites (projection/load-client-data.ts,
 * scenario/loader.ts), both of which finish before any solver mutation. The
 * solver's `stress-disability` mutation writes `planSettings.disabilityEvent`
 * AFTER that, while the projection recomputes `synthesizeDisabilityBenefits`
 * live on every run — so the benefit moved and the premium did not: the client
 * collected a disability benefit and kept paying a premium the insurer had
 * waived.
 *
 * ⚠️ The fixture below MUST be an insured-paid policy with `annualPremium > 0`.
 * `synthesizeDisabilityPremiums` skips `premiumPayer !== "insured"` and
 * `annualPremium <= 0`, and the quick-add WORKPLACE package is employer-paid at
 * a premium of 0 — so a workplace fixture emits no premium row at all and every
 * assertion here would pass against the unfixed code.
 */

import { describe, it, expect } from "vitest";
import type { ClientData, DisabilityPolicy } from "@/engine/types";
import { buildClientData, basePlanSettings } from "@/engine/__tests__/fixtures";
import { withSynthesizedDisabilityPremiums } from "@/lib/insurance-policies/disability-premium-expense";
import type { SolverMutation } from "../types";
import { applyMutations } from "../apply-mutations";

const ROW_ID = "disability-premium-dp-own";
/** baseClient: DOB 1970-01-01, retirementAge 65 => the premium runs to 2035. */
const RETIREMENT_YEAR = 2035;
/** baseClient: spouseDob 1972-06-15, spouseRetirementAge 65 => 2037. */
const SPOUSE_RETIREMENT_YEAR = 2037;
const DISABILITY_YEAR = 2030;

const insuredPaid: DisabilityPolicy = {
  id: "dp-own",
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

/** What the LOADER hands the solver: the premium row already synthesized, with
 *  no disability event yet, so nothing is waived. */
function loadedTree(policy: DisabilityPolicy = insuredPaid): ClientData {
  return withSynthesizedDisabilityPremiums(
    buildClientData({ disabilityPolicies: [policy], expenses: [] }),
  );
}

const premiumRow = (tree: ClientData) => tree.expenses.find((e) => e.id === ROW_ID);

describe("applyMutations re-derives disability premiums from the mutated tree", () => {
  it("stops billing a premium the insurer waived when the stressor is turned on", () => {
    const before = loadedTree();
    // Guards the whole test against the vacuous shape: if the fixture never had
    // a premium row, the assertion below would be checking `undefined`.
    expect(premiumRow(before)?.endYear).toBe(RETIREMENT_YEAR);

    const out = applyMutations(before, [
      { kind: "stress-disability", person: "client", startYear: DISABILITY_YEAR },
    ] as SolverMutation[]);

    expect(premiumRow(out)?.endYear).toBe(DISABILITY_YEAR - 1);
  });

  it("does not waive the premium when the OTHER person is the one disabled", () => {
    const out = applyMutations(loadedTree(), [
      { kind: "stress-disability", person: "spouse", startYear: DISABILITY_YEAR },
    ] as SolverMutation[]);

    expect(premiumRow(out)?.endYear).toBe(RETIREMENT_YEAR);
  });

  it("leaves the row alone when no stressor is applied", () => {
    const out = applyMutations(loadedTree(), [] as SolverMutation[]);
    expect(out.expenses.filter((e) => e.id === ROW_ID)).toHaveLength(1);
    expect(premiumRow(out)?.endYear).toBe(RETIREMENT_YEAR);
  });

  /**
   * The re-derive is not scoped to the disability stressor: it runs on EVERY
   * batch, so any lever feeding `retirementYear` now moves the premium's end
   * year too. That is the loader's own answer — fence it off and moving
   * retirement age gives an end year a save-and-reload would silently change —
   * but the only thing standing between "correct" and "silently wrong for the
   * spouse" is one ternary in `retirementYear`, and moving retirement age is
   * the most-used lever in the product. So it is pinned, in both directions.
   */
  describe("a retirement-age lever moves the premium's end year, for the RIGHT person", () => {
    it("follows the client when the client is the insured", () => {
      const before = loadedTree();
      expect(premiumRow(before)?.endYear).toBe(RETIREMENT_YEAR);

      const out = applyMutations(before, [
        { kind: "retirement-age", person: "client", age: 70 },
      ] as SolverMutation[]);

      expect(premiumRow(out)?.endYear).toBe(2040);
    });

    it("does not let a CLIENT lever move a SPOUSE-insured policy", () => {
      const spouseInsured = { ...insuredPaid, insured: "spouse" as const };
      const before = loadedTree(spouseInsured);
      expect(premiumRow(before)?.endYear).toBe(SPOUSE_RETIREMENT_YEAR);

      const out = applyMutations(before, [
        { kind: "retirement-age", person: "client", age: 70 },
      ] as SolverMutation[]);

      expect(premiumRow(out)?.endYear).toBe(SPOUSE_RETIREMENT_YEAR);
    });

    it("does let a SPOUSE lever move it", () => {
      // The control for the assertion above: without this, "unchanged" would
      // also be satisfied by a re-derive that never moves a spouse policy at
      // all — including one that cannot read `spouseRetirementAge`.
      const out = applyMutations(loadedTree({ ...insuredPaid, insured: "spouse" }), [
        { kind: "retirement-age", person: "spouse", age: 70 },
      ] as SolverMutation[]);

      expect(premiumRow(out)?.endYear).toBe(2042);
    });
  });

  it("leaves the life-insurance premiums alone", () => {
    // `withSynthesizedDisabilityPremiums` strips prior rows by the
    // `disability-premium-` id prefix and deliberately NOT by `source`, because
    // the life-insurance premiums carry `source: "policy"` too. A source-keyed
    // filter here would delete them and never regenerate them.
    const before = loadedTree();
    const lifeRow = {
      id: "premium-acct-li",
      type: "insurance" as const,
      name: "Whole life premium",
      annualAmount: 12_000,
      startYear: basePlanSettings.planStartYear,
      endYear: 2050,
      growthRate: 0,
      source: "policy" as const,
    };
    const out = applyMutations(
      { ...before, expenses: [...before.expenses, lifeRow] },
      [
        { kind: "stress-disability", person: "client", startYear: DISABILITY_YEAR },
      ] as SolverMutation[],
    );

    expect(out.expenses.find((e) => e.id === "premium-acct-li")?.annualAmount).toBe(12_000);
    expect(premiumRow(out)?.endYear).toBe(DISABILITY_YEAR - 1);
  });
});
