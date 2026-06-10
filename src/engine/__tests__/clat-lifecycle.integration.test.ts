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

  // §170(f)(2)(B) / Treas. Reg. 1.170A-6(c)(4): a grantor CLT can be measured
  // on a THIRD party's life. If the grantor dies while that measuring life is
  // still alive, the income interest has NOT terminated, so the unrecovered
  // portion of the original deduction is recaptured. The death does NOT equal
  // the term-end here (the measuring life is the child, not the grantor).
  describe("single_life measured on a child, grantor dies mid-term", () => {
    const base = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutType: "annuity",
      payoutAmount: 60_000,
      payoutPercent: 0,
      termYears: 10, // term-certain factor used by the fixture for the split
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 500_000,
      irc7520Rate: 0.04,
      grantorDeathYear: 2030,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    // Re-point the trust onto the CHILD's life (a non-grantor family member).
    // The child (DOB 2000) has no death event, so it stays alive throughout —
    // the trust's income interest is still running when the grantor dies.
    const si = base.entities![0].splitInterest!;
    si.termType = "single_life";
    si.measuringLife1Id = CLT_FIXTURE_IDS.CHILD_1_FM_ID;
    si.measuringLife2Id = null;
    const years = runProjection(base);

    it("emits recapture in taxDetail.bySource on the grantor's death year", () => {
      const death = years.find((y) => y.year === 2030)!;
      const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
      const entry = death.taxDetail?.bySource?.[key];
      expect(entry).toBeDefined();
      expect(entry!.amount).toBeGreaterThan(0);
    });

    it("recapture ≈ originalIncomeInterest − PV(payments made through death)", () => {
      const death = years.find((y) => y.year === 2030)!;
      const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
      const entry = death.taxDetail!.bySource![key]!;
      // 5 annuity payments of 60k (2026..2030) discounted at the original
      // §7520 rate (4%); offsets t=1..5.
      const r = 0.04;
      let pv = 0;
      for (let t = 1; t <= 5; t++) pv += 60_000 / Math.pow(1 + r, t);
      const expected = Number(si.originalIncomeInterest) - pv;
      expect(entry.amount).toBeCloseTo(expected, 0);
    });
  });
});
