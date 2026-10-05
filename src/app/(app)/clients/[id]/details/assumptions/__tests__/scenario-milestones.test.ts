import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { withdrawalRowsForDisplay } from "../scenario-milestones";
import { treeMilestones } from "@/lib/milestones";

// Mid-year DOB: see year-refs.activation.test.ts for the UTC-parse caveat.
function tree(retirementAge: number): Pick<ClientData, "client" | "planSettings"> {
  return {
    client: { dateOfBirth: "1975-06-15", retirementAge } as ClientData["client"],
    planSettings: { planStartYear: 2025, planEndYear: 2060 } as ClientData["planSettings"],
  };
}

const ROW = {
  id: "ws-1", accountId: "a1", priorityOrder: 1,
  startYear: 2040, endYear: 2060,
  startYearRef: "client_retirement", endYearRef: "plan_end",
};

describe("withdrawalRowsForDisplay", () => {
  it("resolves a retirement-anchored start against the given (scenario) milestones", () => {
    const base = withdrawalRowsForDisplay([ROW], treeMilestones(tree(65)));
    const scenario = withdrawalRowsForDisplay([ROW], treeMilestones(tree(60)));
    expect(base[0].startYear).toBe(2040);
    expect(scenario[0].startYear).toBe(2035);
    expect(scenario[0].endYear).toBe(2060);
  });

  it("leaves a ref-less row's years alone and does not mutate its input", () => {
    const plain = { ...ROW, startYearRef: null, endYearRef: null, startYear: 2031 };
    const out = withdrawalRowsForDisplay([plain, ROW], treeMilestones(tree(60)));
    expect(out[0].startYear).toBe(2031);
    expect(ROW.startYear).toBe(2040);
  });
});
