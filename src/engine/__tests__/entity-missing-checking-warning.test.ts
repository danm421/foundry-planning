/**
 * Audit F13 — a trust with no entity checking account makes zero payments
 * because every payment pass hits `if (!checkingId) continue`. Emit a warning
 * so the condition is at least detectable.
 *
 * The CLT fixture's trust account carries `isDefaultChecking: true`, which is
 * precisely why the existing CLT tests never caught this. This test removes the
 * flag on purpose — a fixture whose corpus is already default-checking proves
 * nothing here.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCltLifecycleFixture, CLT_FIXTURE_IDS } from "./_fixtures/clt";

describe("F13 — entity_missing_checking warning", () => {
  const data = buildCltLifecycleFixture({
    inceptionYear: 2026,
    payoutPercent: 0.06,
    termYears: 5,
    inceptionValue: 1_000_000,
    charityType: "public",
    grantorAgi: 300_000,
    remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
  });

  // Strip the flag so entityCheckingByEntityId (projection.ts:557-563) has no
  // entry for the CLT — the shape a solver-created trust actually produces.
  const trustAccount = data.accounts.find(
    (a) => a.id === CLT_FIXTURE_IDS.CLT_CHECKING_ID,
  )!;
  delete (trustAccount as { isDefaultChecking?: boolean }).isDefaultChecking;

  const years = runProjection(data);

  it("emits the warning for the CLT in a payment year", () => {
    const y = years.find((r) => r.year === 2027)!;
    const warning = y.trustWarnings?.find(
      (w) => w.code === "entity_missing_checking",
    );
    expect(warning).toBeDefined();
    expect(warning).toMatchObject({
      code: "entity_missing_checking",
      entityId: CLT_FIXTURE_IDS.CLT_ENTITY_ID,
      year: 2027,
    });
  });

  // m9: a CLT with isGrantor:false clears every filter in
  // `buildNonGrantorTrusts` (trust + irrevocable + !isGrantor + not §664(c)
  // exempt — only CRTs are), so it is BOTH in `nonGrantorTrusts` and in the CLT
  // annual pass over `currentEntities`. Before the dedupe both passes pushed,
  // emitting the same entityId/year twice. The tests above use the fixture's
  // `isGrantor: true` default, which routes to the grantor pass instead and so
  // never exercised the overlap.
  it("emits exactly ONE warning per entity-year for a non-grantor CLT", () => {
    const nonGrantor = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 300_000,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
      isGrantor: false,
    });
    const acct = nonGrantor.accounts.find(
      (a) => a.id === CLT_FIXTURE_IDS.CLT_CHECKING_ID,
    )!;
    delete (acct as { isDefaultChecking?: boolean }).isDefaultChecking;

    const rows = runProjection(nonGrantor);
    const y = rows.find((r) => r.year === 2027)!;
    const emitted = (y.trustWarnings ?? []).filter(
      (w) =>
        w.code === "entity_missing_checking" &&
        w.entityId === CLT_FIXTURE_IDS.CLT_ENTITY_ID,
    );
    expect(emitted).toHaveLength(1);
  });

  it("does NOT emit the warning when the trust has its checking account", () => {
    const healthy = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 300_000,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const healthyYears = runProjection(healthy);
    for (const y of healthyYears) {
      expect(
        y.trustWarnings?.some((w) => w.code === "entity_missing_checking"),
      ).toBeFalsy();
    }
  });
});
