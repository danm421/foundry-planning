import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { estateDistributionAtYear } from "../estate-distribution-at-year";
import { buildEstateTransferReportData } from "../transfer-report";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";

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
  });
});
