import { describe, expect, it } from "vitest";
import { emptyGoals } from "../goals";

describe("emptyGoals", () => {
  it("emptyGoals is all-empty", () => {
    expect(emptyGoals()).toEqual({
      education: [],
      homePurchases: [],
      riskTolerance: { value: null, provenance: "derived" },
    });
  });
});
