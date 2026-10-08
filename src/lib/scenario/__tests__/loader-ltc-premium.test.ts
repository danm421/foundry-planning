// The scenario loader re-derives LTC premiums over the EFFECTIVE tree, after
// the life-insurance link strips every `source: "policy"` row.
import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import type { ClientData, Expense, LtcPolicy } from "@/engine/types";
import { LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

const policy: LtcPolicy = {
  id: "ltc-1", name: "Genworth", insured: "client", carrier: null, issueYear: 2018,
  ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400, partnership: false, notes: null,
};

function baseTree(expenses: Expense[]): ClientData {
  return {
    client: { dateOfBirth: "1970-01-01", retirementAge: 65, retirementMonth: 1, planEndAge: 95, lifeExpectancy: 90, filingStatus: "single" },
    planSettings: { planStartYear: 2026, planEndYear: 2065, inflationRate: 0.03 },
    accounts: [], incomes: [], expenses, liabilities: [], savingsRules: [], withdrawalStrategy: [],
    transfers: [], rothConversions: [], reinvestments: [], ltcPolicies: [policy],
  } as unknown as ClientData;
}
const ltcRows = (t: ClientData) => t.expenses.filter((e) => e.id === "ltc-premium-ltc-1");

describe("applyScenarioChangesWithRefs — LTC premium re-synthesis", () => {
  it("re-derives a stale base row into exactly one current row", () => {
    const stale: Expense = { id: "ltc-premium-ltc-1", type: "insurance", name: "x", annualAmount: 1, startYear: 2026, endYear: 2099, growthRate: 0, source: "policy" };
    const rows = ltcRows(applyScenarioChangesWithRefs(baseTree([stale]), [], {}, []).effectiveTree);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ annualAmount: 2400, endYear: 2060 });
  });
});

describe("applyScenarioChangesWithRefs — scenario-added and removed LTC policies", () => {
  const add = (payload: unknown) => ({
    id: "ch-add", scenarioId: "scn1", opType: "add" as const, targetKind: "ltc_policy" as const,
    targetId: "ltc-2", payload, toggleGroupId: null, orderIndex: 0,
  });

  it("bills a premium for a policy only the scenario holds", () => {
    const tree = { ...baseTree([]), ltcPolicies: [] };
    const { effectiveTree } = applyScenarioChangesWithRefs(tree, [add({ ...policy, id: "ltc-2", annualPremium: 900 })], {}, []);
    expect(effectiveTree.expenses.filter((e) => e.id === "ltc-premium-ltc-2").map((e) => e.annualAmount)).toEqual([900]);
  });

  it("stops billing a base policy the scenario removed", () => {
    const remove = { ...add(null), opType: "remove" as const, targetId: "ltc-1" };
    const { effectiveTree } = applyScenarioChangesWithRefs(baseTree([]), [remove], {}, []);
    expect(ltcRows(effectiveTree)).toEqual([]);
  });
});
