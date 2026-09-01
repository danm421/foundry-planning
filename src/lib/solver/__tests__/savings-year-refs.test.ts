// A savings rule's start/end year can be anchored to a household milestone
// ("Rachel Retirement") rather than typed as a calendar year. The Solver's
// edit dialog writes the anchor alongside the resolved year; these cover the
// three layers that have to carry it: the working tree, the base-facts write,
// and the scenario diff.

import { describe, it, expect } from "vitest";
import type { ClientData, SavingsRule } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import { mutationsToBaseUpdates } from "../mutations-to-base-updates";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

const RULE: SavingsRule = {
  id: "rule-1",
  accountId: ACCOUNT_ID,
  annualAmount: 60000,
  isDeductible: false,
  startYear: 2026,
  endYear: 2054,
  startYearRef: null,
  endYearRef: "client_retirement",
};

function makeSource(): ClientData {
  return {
    // A real DOB so "client_retirement" resolves: applyMutations re-runs
    // resolveRefYears, and an anchored year is DERIVED from the milestone —
    // the stored number is only a fallback.
    client: { dateOfBirth: "1980-01-01", retirementAge: 65, planEndAge: 95, lifeExpectancy: 95 },
    accounts: [{ id: ACCOUNT_ID, name: "Rachel — Taxable", category: "taxable" }],
    savingsRules: [RULE],
    incomes: [],
    expenses: [],
    withdrawalStrategy: [],
    planSettings: { planStartYear: 2026, planEndYear: 2075 },
  } as unknown as ClientData;
}

describe("savings year refs → working tree", () => {
  it("writes the anchor, and the anchor then DRIVES the year", () => {
    const out = applyMutations(makeSource(), [
      { kind: "savings-start-year", accountId: ACCOUNT_ID, year: 2031, ref: "client_retirement" },
    ]);
    expect(out.savingsRules[0].startYearRef).toBe("client_retirement");
    // Born 1980, retirement age 65 → 2044. The picked year is only a seed; the
    // working tree re-resolves it from the milestone, which is the whole point
    // of anchoring rather than typing a number.
    expect(out.savingsRules[0].startYear).toBe(2044);
  });

  it("clears the anchor when the advisor types a plain year", () => {
    const out = applyMutations(makeSource(), [
      { kind: "savings-end-year", accountId: ACCOUNT_ID, year: 2040, ref: null },
    ]);
    expect(out.savingsRules[0].endYear).toBe(2040);
    expect(out.savingsRules[0].endYearRef).toBeNull();
  });

  it("leaves an existing anchor alone when the lever carries no ref at all", () => {
    // The inline year steppers elsewhere in the Solver emit the bare form.
    const out = applyMutations(makeSource(), [
      { kind: "savings-end-year", accountId: ACCOUNT_ID, year: 2050 },
    ]);
    expect(out.savingsRules[0].endYearRef).toBe("client_retirement");
    // Still anchored, so the typed 2050 loses to the milestone (2044, minus one
    // for an END position — the rule stops the year before retirement).
    expect(out.savingsRules[0].endYear).toBe(2043);
  });
});

describe("savings year refs → base facts", () => {
  it("writes the ref column, not just the year", () => {
    const out = mutationsToBaseUpdates(makeSource(), [
      { kind: "savings-start-year", accountId: ACCOUNT_ID, year: 2031, ref: "client_retirement" },
    ]);
    expect(out.savingsFieldUpdates).toEqual([
      { id: "rule-1", set: { startYear: 2031, startYearRef: "client_retirement" } },
    ]);
  });

  it("writes an explicit null so a de-anchored year does not silently re-anchor", () => {
    const out = mutationsToBaseUpdates(makeSource(), [
      { kind: "savings-end-year", accountId: ACCOUNT_ID, year: 2040, ref: null },
    ]);
    expect(out.savingsFieldUpdates[0].set).toEqual({ endYear: 2040, endYearRef: null });
  });

  it("omits the ref column when the lever carries no ref", () => {
    const out = mutationsToBaseUpdates(makeSource(), [
      { kind: "savings-end-year", accountId: ACCOUNT_ID, year: 2045 },
    ]);
    expect(out.savingsFieldUpdates[0].set).toEqual({ endYear: 2045 });
  });

  it("folds the ref into a rule created in the same batch", () => {
    const freshRule: SavingsRule = { ...RULE, id: "rule-2", startYearRef: null };
    const out = mutationsToBaseUpdates({ accounts: [], savingsRules: [] } as unknown as ClientData, [
      { kind: "savings-rule-upsert", id: "rule-2", value: freshRule },
      { kind: "savings-start-year", accountId: ACCOUNT_ID, year: 2031, ref: "client_retirement" },
    ]);
    expect(out.savingsInserts).toHaveLength(1);
    expect(out.savingsInserts[0].startYearRef).toBe("client_retirement");
    expect(out.savingsFieldUpdates).toHaveLength(0);
  });
});

describe("savings year refs → scenario diff", () => {
  it("records the anchor change so promotion writes it", () => {
    const out = mutationsToScenarioChanges(makeSource(), "client-1", [
      { kind: "savings-start-year", accountId: ACCOUNT_ID, year: 2031, ref: "client_retirement" },
    ]);
    const savings = out.find((c) => c.targetKind === "savings_rule");
    expect(savings?.payload).toMatchObject({
      startYear: { from: 2026, to: 2031 },
      startYearRef: { from: null, to: "client_retirement" },
    });
  });
});

describe("savings year refs → wire schema", () => {
  it("accepts a known anchor", () => {
    const parsed = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "savings-start-year",
      accountId: ACCOUNT_ID,
      year: 2031,
      ref: "client_retirement",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown anchor rather than letting it reach the year_ref enum column", () => {
    const parsed = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "savings-start-year",
      accountId: ACCOUNT_ID,
      year: 2031,
      ref: "when_rachel_feels_like_it",
    });
    expect(parsed.success).toBe(false);
  });
});
