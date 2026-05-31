// Regression test for "premium synthesis runs upstream of scenario apply".
//
// `synthesizePremiumExpenses` runs at base-load time on the BASE accounts, so a
// scenario that ADDS / REMOVES / EDITS a life-insurance account used to sit on
// top of stale premiums. `applyScenarioChangesWithRefs` must re-synthesize
// policy premiums over the effective tree after the overlay is applied.

import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import type { Account, ClientData, Expense } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";

function baseTree(accounts: Account[] = [], expenses: Expense[] = []): ClientData {
  return {
    client: {
      dateOfBirth: "1970-06-15",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 90,
      filingStatus: "single",
    },
    planSettings: { planStartYear: 2025, planEndYear: 2065 },
    accounts,
    incomes: [],
    expenses,
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
  } as unknown as ClientData;
}

function liAccount(id: string, premiumAmount: number): Account {
  return {
    id,
    name: `${id} policy`,
    category: "life_insurance",
    subType: "permanent",
    value: 0,
    basis: 0,
    growthRate: 0,
    owners: [],
    insuredPerson: "client",
    lifeInsurance: { premiumAmount, premiumYears: 10, policyType: "permanent" },
  } as unknown as Account;
}

const premiumsOf = (t: ClientData): Expense[] =>
  t.expenses.filter((e) => e.source === "policy");

describe("applyScenarioChangesWithRefs — life-insurance premium re-synthesis", () => {
  it("synthesizes a premium for a scenario-ADDED life-insurance account", () => {
    const change: ScenarioChange = {
      id: "ch1",
      scenarioId: "scn1",
      opType: "add",
      targetKind: "account",
      targetId: "li-new",
      payload: liAccount("li-new", 5000),
      toggleGroupId: null,
      orderIndex: 0,
    };
    const { effectiveTree } = applyScenarioChangesWithRefs(baseTree(), [change], {}, []);
    const premiums = premiumsOf(effectiveTree);
    expect(premiums).toHaveLength(1);
    expect(premiums[0]).toMatchObject({
      sourcePolicyAccountId: "li-new",
      annualAmount: 5000,
    });
  });

  it("drops the orphan premium of a scenario-REMOVED life-insurance account", () => {
    const orphan: Expense = {
      id: "premium-li1",
      type: "insurance",
      name: "li1 policy premium",
      annualAmount: 5000,
      startYear: 2026,
      endYear: 2035,
      growthRate: 0,
      source: "policy",
      sourcePolicyAccountId: "li1",
    };
    const base = baseTree([liAccount("li1", 5000)], [orphan]);
    const change: ScenarioChange = {
      id: "ch1",
      scenarioId: "scn1",
      opType: "remove",
      targetKind: "account",
      targetId: "li1",
      payload: null,
      toggleGroupId: null,
      orderIndex: 0,
    };
    const { effectiveTree } = applyScenarioChangesWithRefs(base, [change], {}, []);
    expect(premiumsOf(effectiveTree)).toHaveLength(0);
  });
});
