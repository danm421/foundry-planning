import { describe, it, expect } from "vitest";
import { resolveRefYears } from "../year-refs";
import type { ClientData } from "@/engine/types";

// Mid-year DOB: see year-refs.activation.test.ts for the UTC-parse caveat.
function tree(retirementAge: number): ClientData {
  return {
    client: { dateOfBirth: "1975-06-15", retirementAge } as ClientData["client"],
    planSettings: { planStartYear: 2025, planEndYear: 2060 } as ClientData["planSettings"],
    accounts: [], incomes: [], expenses: [], savingsRules: [],
    withdrawalStrategy: [
      {
        id: "ws-1", accountId: "a1", priorityOrder: 1,
        startYear: 2040, endYear: 2060,
        startYearRef: "client_retirement", endYearRef: "plan_end",
      },
    ],
    entities: [], transfers: [], rothConversions: [],
  } as unknown as ClientData;
}

describe("resolveRefYears — withdrawal order", () => {
  it("moves a retirement-anchored start when the client's retirement age moves", () => {
    expect(resolveRefYears(tree(65)).withdrawalStrategy[0].startYear).toBe(2040);
    const moved = resolveRefYears(tree(60)).withdrawalStrategy[0];
    expect(moved.startYear).toBe(2035);
    expect(moved.endYear).toBe(2060);
  });
});
