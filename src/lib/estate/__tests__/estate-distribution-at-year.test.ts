import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { estateDistributionAtYear } from "../estate-distribution-at-year";
import { buildEstateTransferReportData } from "../transfer-report";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";
import { LEGACY_FM_SPOUSE } from "@/engine/ownership";
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
});
