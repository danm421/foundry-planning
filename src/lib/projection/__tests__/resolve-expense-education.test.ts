import { describe, it, expect } from "vitest";
import { resolveExpenseFromRaw } from "../resolve-entity";

const ctx = { resolver: (() => 0) as never, resolvedInflationRate: 0.025 };

describe("resolveExpenseFromRaw education", () => {
  it("carries education fields through", () => {
    const e = resolveExpenseFromRaw(
      {
        id: "edu", type: "education", name: "College", annualAmount: "20000",
        startYear: 2033, endYear: 2036, growthSource: "inflation", growthRate: null,
        payShortfallOutOfPocket: true, institutionState: "PA", institutionName: "Penn State",
        forFamilyMemberId: "fm1", dedicatedAccountIds: ["a1", "a2"],
      } as never,
      ctx as never,
    );
    expect(e.type).toBe("education");
    expect(e.growthRate).toBe(0.025);
    expect(e.dedicatedAccountIds).toEqual(["a1", "a2"]);
    expect(e.payShortfallOutOfPocket).toBe(true);
    expect(e.forFamilyMemberId).toBe("fm1");
  });
});
