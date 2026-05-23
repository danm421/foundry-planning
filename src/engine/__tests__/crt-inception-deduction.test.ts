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
