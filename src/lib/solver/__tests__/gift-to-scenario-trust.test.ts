import { describe, it, expect } from "vitest";
import type { ClientData, EntitySummary } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import { giftFormRecipientsFromClientData } from "@/components/gift-form";

const idgt: EntitySummary = { id: "trust-idgt", name: "Heritage IDGT", entityType: "trust", isIrrevocable: true, isGrantor: true, includeInPortfolio: false, grantor: "client", trustSubType: "idgt" };

function tree(): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [], incomes: [], expenses: [], savingsRules: [], liabilities: [],
    withdrawalStrategy: [],
    entities: [], externalBeneficiaries: [], gifts: [], giftEvents: [],
    taxYearRows: [], familyMembers: [],
  } as unknown as ClientData;
}

describe("gifts to a scenario-created trust", () => {
  it("offers a trust added by entity-upsert as a gift recipient", () => {
    const working = applyMutations(tree(), [{ kind: "entity-upsert", id: "trust-idgt", value: idgt }]);
    const recipients = giftFormRecipientsFromClientData(working);
    expect(recipients.trusts.some((t) => t.id === "trust-idgt" && t.name === "Heritage IDGT")).toBe(true);
  });
});
