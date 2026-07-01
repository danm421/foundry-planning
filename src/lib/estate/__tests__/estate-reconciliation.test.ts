import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { estateDistributionAtYear } from "../estate-distribution-at-year";
import { buildYearlyEstateReport } from "../yearly-estate-report";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";

const owner = (d: ReturnType<typeof buildMarriedEstateFixture>) => ({
  clientName: `${d.client.firstName} ${d.client.lastName}`.trim(),
  spouseName: d.client.spouseName ?? null,
});
const dobs = (d: ReturnType<typeof buildMarriedEstateFixture>) => ({
  clientDob: d.client.dateOfBirth,
  spouseDob: d.client.spouseDob ?? null,
});

describe("estate surfaces reconcile to estateDistributionAtYear", () => {
  it("yearly-estate-report row.totalToHeirs == builder.toHeirs at each estate year", () => {
    const data = buildMarriedEstateFixture();
    const projection = runProjectionWithEvents(data);
    const yearly = buildYearlyEstateReport({
      projection, clientData: data, ordering: "primaryFirst",
      ownerNames: owner(data), ownerDobs: dobs(data),
    });
    for (const row of yearly.rows) {
      const dist = estateDistributionAtYear({
        projection, year: row.year, clientData: data, ownerNames: owner(data),
      });
      expect(row.totalToHeirs).toBeCloseTo(dist.toHeirs, 0);
      expect(row.taxesAndExpenses).toBeCloseTo(dist.taxesAndExpenses, 0);
    }
  });
});
