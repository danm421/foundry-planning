import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "../types";
import { applyMutations } from "../apply-mutations";

// A tree whose loader-baked base gift (cash, id "base-g") is already materialised.
function baseTree(): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025, taxInflationRate: 0.025 },
    accounts: [{ id: "acct-1", name: "B", category: "taxable", value: 500000 }],
    incomes: [], expenses: [], savingsRules: [], liabilities: [], entities: [], externalBeneficiaries: [],
    gifts: [{ id: "base-g", year: 2030, amount: 10000, grantor: "client", useCrummeyPowers: false }],
    giftEvents: [{ kind: "cash", year: 2030, amount: 10000, grantor: "client", useCrummeyPowers: false, sourceGiftId: "base-g" }],
    taxYearRows: [], familyMembers: [], withdrawalStrategy: [],
  } as unknown as ClientData;
}

const editValue = { kind: "cash-once", id: "base-g", year: 2030, amount: 25000, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false } as const;

it("edits a base gift in place (no duplicate)", () => {
  const out = applyMutations(baseTree(), [{ kind: "gift-upsert", id: "base-g", value: editValue }] as SolverMutation[]);
  const cash = out.giftEvents.filter((e) => e.kind === "cash");
  expect(cash).toHaveLength(1);
  expect((cash[0] as { amount: number }).amount).toBe(25000);
});

it("removes a base gift", () => {
  const out = applyMutations(baseTree(), [{ kind: "gift-upsert", id: "base-g", value: null }] as SolverMutation[]);
  expect(out.giftEvents.filter((e) => e.kind === "cash")).toHaveLength(0);
  expect(out.gifts).toHaveLength(0);
});

it("toggles a base gift off (enabled:false drops events)", () => {
  const out = applyMutations(baseTree(), [{ kind: "gift-upsert", id: "base-g", value: { ...editValue, amount: 10000, enabled: false } }] as SolverMutation[]);
  expect(out.giftEvents.filter((e) => e.kind === "cash")).toHaveLength(0);
});

it("is identity when there are no gift mutations", () => {
  const out = applyMutations(baseTree(), [] as SolverMutation[]);
  expect(out.giftEvents).toHaveLength(1);
  expect(out.gifts).toHaveLength(1);
});
