import { describe, it, expect } from "vitest";
import { makePiaEstimator } from "../pia-estimator";

/**
 * The adapter's whole job is binding the right constants to the engine's pure
 * estimator, so that binding is what these tests pin. A silently wrong wage
 * base mis-prices every PIA the planner proposes, and nothing downstream would
 * flag it — the number would just be plausible and wrong.
 *
 * The bend-point arithmetic itself belongs to `engine/socialSecurity/estimatePia`
 * and is covered there.
 */
const CAREER = { yearsEmployed: 20, futureYears: 15 };

describe("makePiaEstimator", () => {
  it("caps covered earnings at the wage base — earnings above it buy no more PIA", () => {
    const estimate = makePiaEstimator();
    expect(estimate({ highestAnnualSalary: 500_000, ...CAREER })).toBe(
      estimate({ highestAnnualSalary: 184_500, ...CAREER }),
    );
  });

  it("does not cap BELOW the wage base — earnings up to it still raise the PIA", () => {
    // Pins the default at 184_500 from the other side: paired with the test
    // above, a default set anywhere lower would fail here and anywhere higher
    // would fail there.
    const estimate = makePiaEstimator();
    expect(estimate({ highestAnnualSalary: 184_500, ...CAREER })).toBeGreaterThan(
      estimate({ highestAnnualSalary: 170_000, ...CAREER }),
    );
  });

  it("honours a caller-supplied wage base over the default", () => {
    const capped = makePiaEstimator(100_000);
    expect(capped({ highestAnnualSalary: 500_000, ...CAREER })).toBe(
      capped({ highestAnnualSalary: 100_000, ...CAREER }),
    );
  });

  it("returns a monthly figure, not an annual one", () => {
    // AIME = min(80000, 184500) * min(20+15, 35) / 420 = 6666.67, between the
    // two bend points: PIA = 0.9*1226 + 0.32*(6666.67-1226) = 2844.41/month.
    // An annual figure would be ~34,133 — three orders off, not a rounding call.
    expect(makePiaEstimator()({ highestAnnualSalary: 80_000, ...CAREER })).toBeCloseTo(2844.41, 2);
  });
});
