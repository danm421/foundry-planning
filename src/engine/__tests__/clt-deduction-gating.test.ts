import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCltLifecycleFixture, CLT_FIXTURE_IDS } from "./_fixtures/clt";

/**
 * Real law:
 *   grantor CLT     → upfront §170(f)(2)(B) deduction, no §642(c),
 *                     §170(f)(2)(B) recapture if grantor status ends early.
 *   non-grantor CLT → no upfront deduction, annual §642(c) instead, no recapture.
 *
 * The engine granted the upfront deduction to ANY CLT while separately granting
 * §642(c) to non-grantor ones — a double deduction on the default config
 * (isGrantor=false). Audit F5.
 *
 * AGI is kept low ($200k → 30% cap = $60k) so the $461k income interest
 * overflows into charityCarryforward.appreciatedPublic. Non-empty carryforward
 * ⇒ the upfront deduction was emitted.
 */
const LOW_AGI = 200_000;

const buildClt = (opts: { isGrantor: boolean; grantorDeathYear?: number }) =>
  buildCltLifecycleFixture({
    inceptionYear: 2026,
    payoutPercent: 0.06,
    termYears: 10,
    inceptionValue: 1_000_000,
    charityType: "public",
    grantorAgi: LOW_AGI,
    isGrantor: opts.isGrantor,
    grantorDeathYear: opts.grantorDeathYear,
  });

describe("CLT inception deduction gating (F5)", () => {
  it("grantor CLT takes the upfront §170(f)(2)(B) deduction", () => {
    const years = runProjection(buildClt({ isGrantor: true }));
    const funding = years.find((y) => y.year === 2026)!;
    const cf = funding.charityCarryforward?.appreciatedPublic ?? [];
    expect(
      cf.length,
      "grantor CLT should emit the upfront deduction (excess over the 30% cap carries forward)",
    ).toBeGreaterThan(0);
  });

  it("non-grantor CLT takes NO upfront deduction — it gets §642(c) instead", () => {
    const years = runProjection(buildClt({ isGrantor: false }));
    const funding = years.find((y) => y.year === 2026)!;
    expect(
      funding.charityCarryforward?.appreciatedPublic ?? [],
      "non-grantor CLT must not take the upfront deduction — it already deducts each payment under §642(c)",
    ).toEqual([]);
  });

  it("non-grantor CLT is in the 1041 pass (where its §642(c) deduction lives)", () => {
    const years = runProjection(buildClt({ isGrantor: false }));
    const y1 = years.find((y) => y.year === 2026)!;
    expect(y1.trustTaxByEntity?.has(CLT_FIXTURE_IDS.CLT_ENTITY_ID)).toBe(true);
  });
});

describe("CLT §170(f)(2)(B) recapture gating (F5)", () => {
  /**
   * ⚠️ REGRESSION GUARD for the trap this batch exists to avoid.
   *
   * The obvious gate — effectiveIsGrantor(id, si.inceptionYear) — silently
   * breaks THIS test. effectiveIsGrantor reads entityMap[id].isGrantor "as of
   * now", and death-event grantor succession rebuilds entityMap with
   * isGrantor:false. So in the death year — exactly when recapture must fire —
   * the naive gate returns false and recapture never fires.
   *
   * The fix snapshots inception status from the immutable data.entities before
   * any flip. If this test goes red, that snapshot has been replaced by a
   * current-status read.
   */
  it("grantor CLT: recapture FIRES when the grantor dies mid-term", () => {
    const years = runProjection(
      buildClt({ isGrantor: true, grantorDeathYear: 2030 }),
    );
    const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
    const fired = years.some((y) => (y.taxDetail?.bySource ?? {})[key] != null);
    expect(
      fired,
      "recapture must fire for a grantor CLT whose grantor dies mid-term",
    ).toBe(true);
  });

  it("non-grantor CLT: NO recapture on grantor death — no deduction was ever taken", () => {
    const years = runProjection(
      buildClt({ isGrantor: false, grantorDeathYear: 2030 }),
    );
    const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
    const fired = years.some((y) => (y.taxDetail?.bySource ?? {})[key] != null);
    expect(
      fired,
      "recapturing a deduction that was never taken is phantom income",
    ).toBe(false);
  });
});
