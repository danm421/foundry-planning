import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import {
  buildClutLifecycleFixture,
  CLUT_FIXTURE_IDS,
} from "./_fixtures/clut";

/**
 * End-to-end CLUT lifecycle integration. Each scenario instantiates the
 * fixture, runs `runProjection`, and asserts on the public output surfaces:
 *
 *   - charitableOutflows / charitableOutflowDetail: annual unitrust
 *   - taxDetail.bySource['clut_recapture:<entityId>']: §170(f)(2)(B) recapture
 *   - trustTerminations: end-of-term distribution
 *
 * Phase 1 limitations are explicit:
 *   - Life-based termination (single_life / joint_life) requires the death-
 *     event-year plumbing for measuring lives — deferred to phase 2.
 *   - `clut_depleted` informational note is unreachable with proportional
 *     unitrust math (% × FMV); fixed-annuity depletion lands with CLAT.
 *   - Pre-grantor-death isGrantor flip is verified through the existing
 *     applyGrantorSuccession (irrevocable + isGrantor branch).
 */
describe("CLUT — full lifecycle integration", () => {
  describe("term-certain, grantor outlives the term", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 10,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
      remainderBeneficiaries: [
        { childIndex: 1, percentage: 60 },
        { childIndex: 2, percentage: 40 },
      ],
    });
    const years = runProjection(data);

    it("auto-emits remainder-interest gift in source ClientData (non-zero amount)", () => {
      const remainderGift = data.gifts?.find(
        (g) => g.eventKind === "clut_remainder_interest",
      );
      expect(remainderGift).toBeDefined();
      expect(remainderGift!.amount).toBeGreaterThan(0);
    });

    it("emits an annual unitrust outflow each year of the term", () => {
      for (let yr = 2026; yr <= 2035; yr++) {
        const y = years.find((r) => r.year === yr)!;
        expect(y.charitableOutflows).toBeGreaterThan(0);
        expect(y.charitableOutflowDetail?.[0].kind).toBe("clut_unitrust");
      }
    });

    it("does not emit an outflow after the term ends (year 2036+)", () => {
      const post = years.find((y) => y.year === 2036)!;
      expect(post.charitableOutflows).toBe(0);
    });

    it("distributes remainder in 2036 (year after term-end)", () => {
      const dist = years.find((y) => y.year === 2036)!;
      expect(dist.trustTerminations).toBeDefined();
      expect(dist.trustTerminations).toHaveLength(1);
      const t = dist.trustTerminations![0];
      expect(t.toBeneficiaries).toHaveLength(2);
      expect(t.totalDistributed).toBeGreaterThan(0);
    });

    it("does not produce recapture (grantor outlived the term)", () => {
      const key = `clut_recapture:${CLUT_FIXTURE_IDS.CLUT_ENTITY_ID}`;
      for (const y of years) {
        expect(y.taxDetail?.bySource?.[key]).toBeUndefined();
      }
    });
  });

  describe("term-certain, grantor dies mid-term", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 15,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 200_000,
      grantorDeathYear: 2030,
      irc7520Rate: 0.022,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const years = runProjection(data);

    it("emits recapture in taxDetail.bySource on the death year", () => {
      const death = years.find((y) => y.year === 2030)!;
      const key = `clut_recapture:${CLUT_FIXTURE_IDS.CLUT_ENTITY_ID}`;
      const entry = death.taxDetail?.bySource?.[key];
      expect(entry).toBeDefined();
      expect(entry!.type).toBe("ordinary_income");
      expect(entry!.amount).toBeGreaterThan(0);
    });

    it("does not double-emit recapture in subsequent years", () => {
      const key = `clut_recapture:${CLUT_FIXTURE_IDS.CLUT_ENTITY_ID}`;
      const post = years.filter((y) => y.year > 2030);
      for (const y of post) {
        expect(y.taxDetail?.bySource?.[key]).toBeUndefined();
      }
    });

    it("continues paying unitrust to charity after grantor death until original term-end", () => {
      // Years post-death continue annual payment until inceptionYear + termYears - 1
      // (2026 + 15 - 1 = 2040)
      for (let yr = 2031; yr <= 2040; yr++) {
        const y = years.find((r) => r.year === yr);
        if (!y) continue; // plan may end earlier
        expect(y.charitableOutflows).toBeGreaterThan(0);
      }
    });
  });
});
