// Regression test for "the disability premium is re-synthesized per scenario".
//
// `withSynthesizedDisabilityPremiums` runs at base-load time against the BASE
// plan settings, so a saved scenario that turns the disability stress test ON
// used to keep billing the premium straight through the disabled years — the
// waiver of premium never fired outside the base tree. Worse, once the row
// carries `source: "policy"` (so the editable surfaces hide it),
// `withSynthesizedPremiums` STRIPS it on every scenario load, so without a
// re-derivation link the disability premium vanishes from scenarios entirely.
//
// `applyScenarioChangesWithRefs` must therefore re-synthesize disability
// premiums over the effective tree, AFTER `withSynthesizedPremiums`.

import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import type { ClientData, DisabilityPolicy, Expense } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";

const policy: DisabilityPolicy = {
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

const ROW_ID = "disability-premium-dp-1";

/** The row as base load produces it: billed to the client's retirement year
 *  (DOB 1970 + retirementAge 65 = 2035), no disability event in the base tree. */
function baseRow(endYear = 2035): Expense {
  return {
    id: ROW_ID,
    type: "insurance",
    name: "Individual LTD premium",
    annualAmount: 2400,
    startYear: 2026,
    endYear,
    growthRate: 0.03,
    source: "policy",
  };
}

function baseTree(expenses: Expense[]): ClientData {
  return {
    client: {
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 90,
      filingStatus: "single",
    },
    planSettings: { planStartYear: 2026, planEndYear: 2065, inflationRate: 0.03 },
    accounts: [],
    incomes: [],
    expenses,
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
    disabilityPolicies: [policy],
  } as unknown as ClientData;
}

const disabilityRows = (t: ClientData): Expense[] =>
  t.expenses.filter((e) => e.id === ROW_ID);

function setDisabilityEvent(startYear: number): ScenarioChange {
  return {
    id: "ch1",
    scenarioId: "scn1",
    opType: "edit",
    targetKind: "plan_settings",
    targetId: "plan_settings",
    payload: {
      disabilityEvent: { from: null, to: { person: "client", startYear } },
    },
    toggleGroupId: null,
    orderIndex: 0,
  };
}

describe("applyScenarioChangesWithRefs — disability premium re-synthesis", () => {
  it("stops the premium the year before a SCENARIO's disability event starts", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree([baseRow()]),
      [setDisabilityEvent(2030)],
      {},
      [],
    );
    const rows = disabilityRows(effectiveTree);
    expect(rows).toHaveLength(1);
    expect(rows[0].endYear).toBe(2029);
  });

  it("re-derives a stale base row and never duplicates it when the scenario has no disability event", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree([baseRow(2050)]),
      [],
      {},
      [],
    );
    const rows = disabilityRows(effectiveTree);
    expect(rows).toHaveLength(1);
    expect(rows[0].endYear).toBe(2035);
  });
});
