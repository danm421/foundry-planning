import { describe, it, expect } from "vitest";
import { solveLifeInsuranceNeed, TOLERANCE_FOR_TEST, CAP } from "../solve-need";
import { marriedBase, assumptions, highNetWorthBase, hnwAssumptions } from "./test-helpers";
import { computeEstateTaxAddend } from "../estate-tax-addend";

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

describe("solveLifeInsuranceNeed convergence", () => {
  it("lands the achieved portfolio within tolerance of the target", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client", assumptions);
    expect(r.status).toBe("solved");
    const relError =
      Math.abs(r.achievedEndingPortfolio - assumptions.leaveToHeirsAmount) /
      assumptions.leaveToHeirsAmount;
    expect(relError).toBeLessThanOrEqual(TOLERANCE_FOR_TEST);
  });

  it("converges for a range of death years", () => {
    for (const deathYear of [2027, 2035, 2050]) {
      const r = solveLifeInsuranceNeed(marriedBase(), "client", {
        ...assumptions,
        deathYear,
      });
      expect(r.status).toBe("solved");
      const relError =
        Math.abs(r.achievedEndingPortfolio - assumptions.leaveToHeirsAmount) /
        assumptions.leaveToHeirsAmount;
      expect(relError).toBeLessThanOrEqual(TOLERANCE_FOR_TEST);
    }
  });
});

describe("solveLifeInsuranceNeed — cover estate taxes", () => {
  // The HNW fixture's survivor portfolio at faceValue=0 is ~$66.9M, so we
  // use a target above that to force a genuine positive baseline face value.
  // 80_000_000 was validated to produce baseline.faceValue ≈ $2.5M.
  const hnwTarget = 80_000_000;

  it("raises the solved face value when the estate-tax addend is folded in", () => {
    const tree = highNetWorthBase();
    const addend = computeEstateTaxAddend(tree, "client", hnwAssumptions);
    expect(addend).toBeGreaterThan(0);

    const assumptionsWithTarget = { ...hnwAssumptions, leaveToHeirsAmount: hnwTarget };
    const baseline = solveLifeInsuranceNeed(tree, "client", assumptionsWithTarget);
    const covered = solveLifeInsuranceNeed(tree, "client", {
      ...assumptionsWithTarget,
      leaveToHeirsAmount: hnwTarget + addend,
    });

    expect(baseline.status).toBe("solved");
    expect(covered.status).toBe("solved");
    // The augmented target is strictly larger, so the solved coverage is too.
    expect(covered.faceValue).toBeGreaterThan(baseline.faceValue);
    // The covered solve lands its ending portfolio on the augmented target.
    expect(covered.achievedEndingPortfolio).toBeGreaterThan(
      baseline.achievedEndingPortfolio,
    );
  });

});

describe("solveLifeInsuranceNeed — reference-probe seeding (speedup v2)", () => {
  it("converges to the same root when given a warm-start seed", () => {
    const cold = solveLifeInsuranceNeed(marriedBase(), "client", assumptions);
    const warm = solveLifeInsuranceNeed(marriedBase(), "client", assumptions, {
      seedFace: cold.faceValue, // previous-year answer as the seed
    });
    expect(warm.status).toBe("solved");
    // Same unique root within the solver's tolerance band.
    const rel = Math.abs(warm.faceValue - cold.faceValue) / cold.faceValue;
    expect(rel).toBeLessThanOrEqual(0.01);
    const err =
      Math.abs(warm.achievedEndingPortfolio - assumptions.leaveToHeirsAmount) /
      assumptions.leaveToHeirsAmount;
    expect(err).toBeLessThanOrEqual(TOLERANCE_FOR_TEST);
  });

  it("converges with an overshooting seed (bracket [0, seed])", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client", assumptions, {
      seedFace: 18_000_000, // far above the true root → eRef >= target branch
    });
    expect(r.status).toBe("solved");
    const err =
      Math.abs(r.achievedEndingPortfolio - assumptions.leaveToHeirsAmount) /
      assumptions.leaveToHeirsAmount;
    expect(err).toBeLessThanOrEqual(TOLERANCE_FOR_TEST);
  });

  it("converges with an undershooting seed (CAP fallback branch)", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client", assumptions, {
      seedFace: 1_000, // far below the true root → eRef < target → CAP fallback
    });
    expect(r.status).toBe("solved");
    const err =
      Math.abs(r.achievedEndingPortfolio - assumptions.leaveToHeirsAmount) /
      assumptions.leaveToHeirsAmount;
    expect(err).toBeLessThanOrEqual(TOLERANCE_FOR_TEST);
  });

  it("skips the internal face-0 probe when atZero is supplied", () => {
    // atZero provided ⇒ zero-need short-circuit fires without any projection.
    const r = solveLifeInsuranceNeed(marriedBase(), "client",
      { ...assumptions, leaveToHeirsAmount: 100 }, { atZero: 5_000 });
    expect(r).toEqual({ status: "solved", faceValue: 0, achievedEndingPortfolio: 5_000 });
  });

  it("still reports exceeds-cap for an unreachable target", () => {
    const r = solveLifeInsuranceNeed(marriedBase(), "client",
      { ...assumptions, leaveToHeirsAmount: 10_000_000_000 });
    expect(r.status).toBe("exceeds-cap");
    expect(r.faceValue).toBe(CAP);
  });
});
