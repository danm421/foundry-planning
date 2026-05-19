import { describe, it, expect } from "vitest";
import { solveLifeInsuranceNeed } from "../solve-need";
import { marriedBase, assumptions } from "./test-helpers";

describe("solveLifeInsuranceNeed", () => {
  it("solves a face value so the survivor's ending portfolio meets the target", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client", assumptions);
    expect(r.status).toBe("solved");
    expect(r.faceValue).toBeGreaterThan(0);
  });

  it("returns $0 need when the survivor already clears the target", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client",
      { ...assumptions, leaveToHeirsAmount: 0 });
    expect(r.faceValue).toBe(0);
  });

  it("reports exceeds-cap when the target is unreachable", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client",
      { ...assumptions, leaveToHeirsAmount: 10_000_000_000 });
    expect(r.status).toBe("exceeds-cap");
  });
});
