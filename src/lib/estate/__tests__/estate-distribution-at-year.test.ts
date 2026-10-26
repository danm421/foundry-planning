import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import {
  estateDistributionAtYear,
  heldInTrustForHeirsAtEndOfLife,
} from "../estate-distribution-at-year";
import { estateHeirTotalsEol } from "@/lib/solver/solver-summary-metrics";
import { buildEstateTransferReportData } from "../transfer-report";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import { applyGiftsToClientData } from "../estate-flow-gifts";

const owner = (d: ReturnType<typeof buildMarriedEstateFixture>) => ({
  clientName: `${d.client.firstName} ${d.client.lastName}`.trim(),
  spouseName: d.client.spouseName ?? null,
});

describe("estateDistributionAtYear", () => {
  it("equals summarizeHousehold(transfer report) for the same year", () => {
    const data = buildMarriedEstateFixture();
    const projection = runProjectionWithEvents(data);
    const Y = projection.secondDeathEvent!.year;
    const dist = estateDistributionAtYear({
      projection,
      year: Y,
      clientData: data,
      ownerNames: owner(data),
    });
    const rep = buildEstateTransferReportData({
      projection,
      asOf: { kind: "year", year: Y },
      ordering: "primaryFirst",
      clientData: data,
      ownerNames: owner(data),
    });
    const h = summarizeHousehold(rep);
    expect(dist.toHeirs).toBeCloseTo(h.netToHeirs, 2);
    expect(dist.taxesAndExpenses).toBeCloseTo(h.taxAndCosts, 2);
    expect(dist.lifetimeGifts).toBe(0);
  });

  describe("lifetime gifts to heirs", () => {
    // $19k a year to Alice, plus one-off gifts to the spouse and to a charity —
    // neither of which is an heir.
    function giftingPlan() {
      const data = buildMarriedEstateFixture();
      data.externalBeneficiaries = [
        { id: "charity-1", name: "Food Bank", kind: "charity", charityType: "public" },
      ];
      return applyGiftsToClientData(
        data,
        [
          { kind: "series", id: "s-alice", startYear: 2026, endYear: 2035, annualAmount: 19_000,
            amountMode: "fixed", inflationAdjust: false, grantor: "client",
            recipient: { kind: "family_member", id: "kid-a" }, crummey: false },
          { kind: "cash-once", id: "g-spouse", year: 2027, amount: 40_000, grantor: "client",
            recipient: { kind: "family_member", id: LEGACY_FM_SPOUSE }, crummey: false },
          { kind: "cash-once", id: "g-charity", year: 2027, amount: 30_000, grantor: "client",
            recipient: { kind: "external_beneficiary", id: "charity-1" }, crummey: false },
        ],
        0.025,
      );
    }

    it("adds the gifts made to heirs by the year to what heirs receive at death", () => {
      const data = giftingPlan();
      const projection = runProjectionWithEvents(data);
      const at = (year: number) =>
        estateDistributionAtYear({ projection, year, clientData: data, ownerNames: owner(data) });
      const atDeathOnly = (year: number) =>
        summarizeHousehold(
          buildEstateTransferReportData({
            projection, asOf: { kind: "year", year }, ordering: "primaryFirst",
            clientData: data, ownerNames: owner(data),
          }),
        ).netToHeirs;

      expect(at(2028).lifetimeGifts).toBe(57_000);
      expect(at(2028).toHeirs).toBeCloseTo(atDeathOnly(2028) + 57_000, 2);
      const final = projection.secondDeathEvent!.year;
      expect(at(final).lifetimeGifts).toBe(190_000);
      expect(at(final).toHeirs).toBeCloseTo(atDeathOnly(final) + 190_000, 2);
    });
  });

  describe("money held in trust for heirs", () => {
    // A $2M brokerage account owned by a trust whose remainder goes to Alice.
    function trustPlan(opts: { irrevocable?: boolean; charityPct?: number } = {}) {
      const data = buildMarriedEstateFixture();
      const charityPct = opts.charityPct ?? 0;
      data.externalBeneficiaries = [
        { id: "charity-1", name: "Food Bank", kind: "charity", charityType: "public" },
      ];
      data.entities = [
        {
          id: "dyn",
          name: "Dynasty Trust",
          entityType: "trust",
          isIrrevocable: opts.irrevocable ?? true,
          isGrantor: false,
          includeInPortfolio: false,
          grantor: "client",
          remainderBeneficiaries: [
            { familyMemberId: "kid-a", percentage: 100 - charityPct, distributionForm: "in_trust" },
            ...(charityPct > 0
              ? [{ externalBeneficiaryId: "charity-1", percentage: charityPct, distributionForm: "outright" as const }]
              : []),
          ],
        },
      ];
      data.accounts.push({
        id: "trust-brok",
        name: "Trust Brokerage",
        category: "taxable",
        subType: "brokerage",
        titlingType: "jtwros",
        value: 2_000_000,
        basis: 2_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "entity", entityId: "dyn", percent: 1 }],
      });
      return data;
    }
    const atDeathOnly = (
      data: ReturnType<typeof trustPlan>,
      projection: ReturnType<typeof runProjectionWithEvents>,
      year: number,
    ) =>
      summarizeHousehold(
        buildEstateTransferReportData({
          projection, asOf: { kind: "year", year }, ordering: "primaryFirst",
          clientData: data, ownerNames: owner(data),
        }),
      ).netToHeirs;
    const trustValue = (projection: ReturnType<typeof runProjectionWithEvents>, year: number) =>
      projection.years.find((y) => y.year === year)!.accountLedgers["trust-brok"].endingValue;

    it("adds what an irrevocable trust holds for the heirs", () => {
      const data = trustPlan();
      const projection = runProjectionWithEvents(data);
      for (const year of [2030, projection.secondDeathEvent!.year]) {
        const dist = estateDistributionAtYear({ projection, year, clientData: data, ownerNames: owner(data) });
        expect(trustValue(projection, year)).toBeGreaterThan(1_000_000);
        expect(dist.heldInTrust).toBeCloseTo(trustValue(projection, year), 2);
        expect(dist.toHeirs).toBeCloseTo(atDeathOnly(data, projection, year) + dist.heldInTrust, 2);
      }
    });

    it("adds it to the end-of-life Net to Heirs too", () => {
      const data = trustPlan();
      const projection = runProjectionWithEvents(data);
      const final = projection.secondDeathEvent!.year;
      const atDeath = summarizeHousehold(
        buildEstateTransferReportData({
          projection, asOf: { kind: "split" }, ordering: "primaryFirst",
          clientData: data, ownerNames: owner(data),
        }),
      ).netToHeirs;
      expect(heldInTrustForHeirsAtEndOfLife(data, projection)).toBeCloseTo(trustValue(projection, final), 2);
      expect(estateHeirTotalsEol(projection, data, owner(data))!.netToHeirs).toBeCloseTo(
        atDeath + trustValue(projection, final),
        2,
      );
    });

    it("leaves out the share the trust's remainder leaves to charity", () => {
      const data = trustPlan({ charityPct: 25 });
      const projection = runProjectionWithEvents(data);
      const dist = estateDistributionAtYear({ projection, year: 2030, clientData: data, ownerNames: owner(data) });
      expect(dist.heldInTrust).toBeCloseTo(trustValue(projection, 2030) * 0.75, 2);
    });

    it("adds nothing for a revocable trust — its money is already in the estate", () => {
      const data = trustPlan({ irrevocable: false });
      const projection = runProjectionWithEvents(data);
      const dist = estateDistributionAtYear({ projection, year: 2030, clientData: data, ownerNames: owner(data) });
      expect(dist.heldInTrust).toBe(0);
    });

    it("does not count a first-death bequest into the trust twice after that death", () => {
      // The client's will leaves a $1M account to the trust at the 2045 death.
      // From then on it sits in the trust AND in the first death's transfers.
      const data = trustPlan();
      data.accounts.push({
        id: "client-sep",
        name: "Client Separate",
        category: "cash",
        subType: "savings",
        titlingType: "jtwros",
        value: 1_000_000,
        basis: 1_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      });
      data.wills![0].bequests.unshift({
        id: "beq-trust",
        name: "Separate account to the trust",
        kind: "asset",
        assetMode: "specific",
        accountId: "client-sep",
        liabilityId: null,
        entityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: -1,
        recipients: [{ recipientKind: "entity", recipientId: "dyn", percentage: 100, sortOrder: 0 }],
      });
      const projection = runProjectionWithEvents(data);
      const final = projection.secondDeathEvent!.year;
      const dist = estateDistributionAtYear({ projection, year: final, clientData: data, ownerNames: owner(data) });
      // Only the trust's own $2M is new; the bequest already counts at death.
      expect(dist.toHeirs - atDeathOnly(data, projection, final)).toBeCloseTo(trustValue(projection, final), 0);
    });
  });
});
