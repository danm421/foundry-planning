import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import {
  buildCltLifecycleFixture,
  CLT_FIXTURE_IDS,
} from "./_fixtures/clt";

/**
 * End-to-end CLAT lifecycle integration. Mirrors clt-lifecycle.integration.test
 * but exercises the annuity (fixed-payment) variant. Inspects:
 *   - charitableOutflows / charitableOutflowDetail: fixed annual amount
 *   - taxDetail.bySource['clt_recapture:<entityId>']: §170(f)(2)(B) on death
 *   - trustTerminations: end-of-term distribution
 */
describe("CLAT — full lifecycle integration", () => {
  describe("term-certain, grantor outlives the term", () => {
    const data = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutType: "annuity",
      payoutAmount: 60_000,
      payoutPercent: 0, // unused for annuity; required by interface
      termYears: 10,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
      irc7520Rate: 0.04,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const years = runProjection(data);

    it("auto-emits remainder-interest gift = inceptionValue - payoutAmount × a_n", () => {
      // a_10 at 4% = 8.110896 → income ≈ 486,654 → remainder ≈ 513,346
      const remainderGift = data.gifts?.find(
        (g) => g.eventKind === "clt_remainder_interest",
      );
      expect(remainderGift).toBeDefined();
      expect(remainderGift!.amount).toBeCloseTo(513_346, 0);
    });

    it("pays $60,000 to charity each year of the 10-year term", () => {
      for (let yr = 2026; yr <= 2035; yr++) {
        const y = years.find((r) => r.year === yr)!;
        const total = (y.charitableOutflowDetail ?? []).reduce(
          (s, d) => s + d.amount,
          0,
        );
        expect(total).toBeCloseTo(60_000, 0);
      }
    });

    it("does not emit an outflow after the term ends (year 2036+)", () => {
      const post = years.find((y) => y.year === 2036)!;
      expect(post.charitableOutflows).toBe(0);
    });

    it("distributes remainder in 2036 (year after term-end)", () => {
      const dist = years.find((y) => y.year === 2036)!;
      expect(dist.trustTerminations).toBeDefined();
      expect(dist.trustTerminations!.length).toBeGreaterThan(0);
      expect(dist.trustTerminations![0].totalDistributed).toBeGreaterThan(0);
    });

    it("does not produce recapture (grantor outlived the term)", () => {
      const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
      for (const y of years) {
        expect(y.taxDetail?.bySource?.[key]).toBeUndefined();
      }
    });
  });

  describe("term-certain, grantor dies mid-term", () => {
    const data = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutType: "annuity",
      payoutAmount: 60_000,
      payoutPercent: 0,
      termYears: 10,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 500_000,
      irc7520Rate: 0.04,
      grantorDeathYear: 2030,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const years = runProjection(data);

    it("emits recapture in taxDetail.bySource on the death year", () => {
      const death = years.find((y) => y.year === 2030)!;
      const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
      const entry = death.taxDetail?.bySource?.[key];
      expect(entry).toBeDefined();
      expect(entry!.amount).toBeGreaterThan(0);
    });
  });
});
