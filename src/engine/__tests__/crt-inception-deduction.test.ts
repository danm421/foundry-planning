import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCrtLifecycleFixture, CRT_FIXTURE_IDS } from "./_fixtures/crt";

/**
 * Sanity check for the CRT fixture's interest-split math + projection liveness.
 * Full lifecycle assertions (annual payments, termination distribution to
 * charity, no §170(f)(2)(B) recapture on grantor death) live in
 * trust-split-interest/__tests__/crt-projection.test.ts.
 *
 * Numbers (CRUT, 6% payout, 10-year term, $1M corpus):
 *   originalRemainderInterest = 1_000_000 × (1 - 0.06)^10 ≈ 538,615
 *   originalIncomeInterest    = 1_000_000 - 538,615        ≈ 461,385
 */
describe("CRT inception deduction sanity", () => {
  it("fixture targets a CRT trust with the expected split-interest split", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 10,
      inceptionValue: 1_000_000,
      irc7520Rate: 0.022,
    });

    const trust = data.entities!.find(
      (e) => e.id === CRT_FIXTURE_IDS.CRT_ENTITY_ID,
    )!;
    expect(trust.trustSubType).toBe("crt");
    expect(trust.splitInterest).toBeDefined();
    const si = trust.splitInterest!;
    expect(si.originalRemainderInterest).toBeCloseTo(538_615, 0);
    expect(si.originalIncomeInterest).toBeCloseTo(461_385, 0);

    // Liveness: the engine doesn't throw when projecting a CRT-only scenario.
    expect(() => runProjection(data)).not.toThrow();
  });
});

/**
 * Estate-trusts audit 2026-09-05, F6: the CRT's upfront §170 deduction was
 * display-only — `originalRemainderInterest` had no consumer in the engine,
 * so a CRT got no charitable deduction in its funding year while a CLT did.
 * The donor deducts the present value of the REMAINDER (the slice that ends
 * up with the charity), subject to the 30%-of-AGI ceiling for a public
 * charity (20% private), and it is the donor's deduction whether or not the
 * trust's cash flow is modeled as grantor.
 */
describe("CRT inception charitable deduction", () => {
  const remainder = 538_615; // 1M × 0.94^10
  const charitableTaken = (data: ReturnType<typeof buildCrtLifecycleFixture>, year: number) => {
    const y = runProjection(data).find((r) => r.year === year)!;
    return {
      charitable: y.deductionBreakdown?.belowLine.charitable ?? 0,
      carryforward: (y.charityCarryforward?.appreciatedPublic ?? []).reduce((s, lot) => s + lot.amount, 0),
    };
  };
  const base = { inceptionYear: 2026, payoutPercent: 0.06, termYears: 10, inceptionValue: 1_000_000, irc7520Rate: 0.022 };

  it("deducts the remainder interest in the funding year when AGI is ample (public charity, 30% ceiling)", () => {
    const { charitable, carryforward } = charitableTaken(
      buildCrtLifecycleFixture({ ...base, grantorAgi: 5_000_000 }),
      2026,
    );
    // Whole remainder taken, less only the 0.5%-of-AGI floor haircut.
    expect(charitable).toBeGreaterThan(500_000);
    expect(charitable).toBeLessThanOrEqual(remainder);
    expect(carryforward).toBe(0);
  });

  it("caps the deduction at 30% of AGI and carries the excess forward", () => {
    const { carryforward } = charitableTaken(
      buildCrtLifecycleFixture({ ...base, grantorAgi: 200_000 }),
      2026,
    );
    // AGI ≈ $200k salary + the first CRUT payment; 30% of that is well under
    // $100k, so most of the $538,615 remainder waits in the carryforward.
    expect(carryforward).toBeGreaterThan(400_000);
    expect(carryforward).toBeLessThan(remainder);
  });

  it("is the donor's deduction even when the CRT is not modeled as a grantor trust", () => {
    const { charitable } = charitableTaken(
      buildCrtLifecycleFixture({ ...base, grantorAgi: 5_000_000, isGrantor: false }),
      2026,
    );
    expect(charitable).toBeGreaterThan(500_000);
  });

  it("does not re-emit the deduction in later years", () => {
    const { charitable, carryforward } = charitableTaken(
      buildCrtLifecycleFixture({ ...base, grantorAgi: 5_000_000 }),
      2027,
    );
    expect(charitable).toBe(0);
    expect(carryforward).toBe(0);
  });
});
