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
