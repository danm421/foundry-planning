import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import {
  buildCrtLifecycleFixture,
  CRT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/crt";

/**
 * Engine-level integration tests for the CRT annual-payment + termination
 * passes in projection.ts. CRT semantics differ from CLT in three places:
 *   1. The income beneficiary is the GRANTOR (household), not the charity.
 *   2. The distribution is ordinary income to the household 1040.
 *   3. At termination, the trust corpus goes to the CHARITY.
 *   4. NO §170(f)(2)(B) recapture fires when the grantor dies during the term.
 */
describe("CRT — annual payment + termination passes", () => {
  it("CRUT: pays payoutPercent × BoY trust FMV to the household each year of the term", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);

    const year1 = years.find((y) => y.year === 2026)!;
    const trustLedger = year1.accountLedgers[CRT_FIXTURE_IDS.CRT_CHECKING_ID];
    const householdLedger =
      year1.accountLedgers[CRT_FIXTURE_IDS.HOUSEHOLD_CHECKING_ID];
    expect(trustLedger).toBeDefined();
    expect(householdLedger).toBeDefined();

    // First-year unitrust: 6% × $1M = $60,000 leaving the trust, landing on
    // the household checking.
    const trustEntry = trustLedger.entries?.find((e) =>
      e.label.includes("CRUT unitrust payment to grantor"),
    );
    expect(trustEntry).toBeDefined();
    expect(trustEntry!.amount).toBeCloseTo(-60_000, 0);

    const householdEntry = householdLedger.entries?.find((e) =>
      e.label.includes("CRUT unitrust payment to grantor"),
    );
    expect(householdEntry).toBeDefined();
    expect(householdEntry!.amount).toBeCloseTo(60_000, 0);
  });

  it("CRAT: pays the fixed payoutAmount to the household each year of the term", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutType: "annuity",
      payoutAmount: 50_000,
      termYears: 5,
      inceptionValue: 1_000_000,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);

    for (let yr = 2026; yr <= 2030; yr++) {
      const y = years.find((r) => r.year === yr)!;
      const householdLedger =
        y.accountLedgers[CRT_FIXTURE_IDS.HOUSEHOLD_CHECKING_ID];
      const entry = householdLedger.entries?.find((e) =>
        e.label.includes("CRAT annuity payment to grantor"),
      );
      expect(entry, `CRAT entry expected on household ledger in ${yr}`).toBeDefined();
      expect(entry!.amount).toBeCloseTo(50_000, 0);
    }
  });

  it("annual CRT distribution appears as ordinary income in taxDetail.bySource", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);
    const year1 = years.find((y) => y.year === 2026)!;
    const key = `crt_distribution:${CRT_FIXTURE_IDS.CRT_ENTITY_ID}`;
    const entry = year1.taxDetail?.bySource?.[key];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("ordinary_income");
    expect(entry!.amount).toBeCloseTo(60_000, 0);
  });

  it("trust corpus drains to the charity in the year-after-term-end", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);
    // inceptionYear=2026, termYears=5 → payments 2026-2030, termination 2031.
    const term = years.find((y) => y.year === 2031)!;
    expect(term.trustTerminations).toBeDefined();
    expect(term.trustTerminations).toHaveLength(1);

    const result = term.trustTerminations![0];
    expect(result.trustId).toBe(CRT_FIXTURE_IDS.CRT_ENTITY_ID);
    expect(result.totalDistributed).toBeGreaterThan(0);
    expect(result.toBeneficiaries).toHaveLength(1);
    expect(result.toBeneficiaries[0].externalBeneficiaryId).toBe(
      CRT_FIXTURE_IDS.PUBLIC_CHARITY_ID,
    );
    expect(result.toBeneficiaries[0].familyMemberId).toBeUndefined();

    // The trust account is drained.
    const trustLedger = term.accountLedgers[CRT_FIXTURE_IDS.CRT_CHECKING_ID];
    expect(trustLedger).toBeDefined();
    const drainEntry = trustLedger.entries?.find((e) =>
      e.label.includes("CRT termination distribution to charity"),
    );
    expect(drainEntry).toBeDefined();
    expect(drainEntry!.amount).toBeLessThan(0);
    expect(trustLedger.endingValue).toBeCloseTo(0, 0);
  });

  it("emits NO §170(f)(2)(B) recapture when the grantor dies during the term", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 15,
      inceptionValue: 1_000_000,
      grantorDeathYear: 2030,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);

    // No CRT entity should ever appear under a `clt_recapture:` or
    // `crt_recapture:` key — recapture is a CLT-only concept.
    for (const y of years) {
      const sources = y.taxDetail?.bySource ?? {};
      for (const k of Object.keys(sources)) {
        expect(
          k.startsWith("clt_recapture:") || k.startsWith("crt_recapture:"),
          `unexpected recapture source ${k} in year ${y.year}`,
        ).toBe(false);
      }
    }
  });
});
