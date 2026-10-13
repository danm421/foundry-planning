import { describe, it, expect } from "vitest";
import { buildEstateSummaryData, estateChartBar } from "../view-model";
import type { EstateSummaryHousehold } from "../aggregate";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ClientData } from "@/engine/types";
import { runProjectionWithEvents } from "@/engine";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";
import { applyGiftsToClientData } from "@/lib/estate/estate-flow-gifts";

/**
 * Segment values chosen so no two are equal, and so the two derived fields are
 * consistent with them: a mapping that read `state` off `probate` would still
 * pass against a fixture of repeated numbers.
 *
 * `taxAndCosts` = federal + state + probate + ird = 930_000 (debts excluded —
 * money owed is not a cost of dying).
 * `estateValue` = netToHeirs + those four + debts = 4_280_000.
 */
const household: EstateSummaryHousehold = {
  federal: 500_000,
  state: 90_000,
  probate: 200_000,
  ird: 140_000,
  debts: 250_000,
  netToHeirs: 3_100_000,
  taxAndCosts: 930_000,
  estateValue: 4_280_000,
};

describe("estateChartBar", () => {
  it("carries every segment the chart stacks, each from its own field", () => {
    expect(estateChartBar("Current plan", household)).toEqual({
      label: "Current plan",
      netToHeirs: 3_100_000,
      federal: 500_000,
      state: 90_000,
      probate: 200_000,
      ird: 140_000,
      debts: 250_000,
      total: 4_280_000,
    });
  });

  it("takes the bar's total from estateValue, NOT from taxAndCosts", () => {
    // The two are both money, both about the estate, and one is a fifth of the
    // other. `total` is the whole bar's height; `taxAndCosts` is four of its six
    // segments.
    expect(estateChartBar("x", household).total).toBe(household.estateValue);
  });

  it("stacks to its own total, so no segment is dropped or double-counted", () => {
    const bar = estateChartBar("x", household);
    expect(bar.netToHeirs + bar.federal + bar.state + bar.probate + bar.ird + bar.debts).toBe(
      bar.total,
    );
  });
});

describe("buildEstateSummaryData — lifetime gifts to heirs", () => {
  const summaryOf = (clientData: ClientData) => {
    const projection = runProjectionWithEvents(clientData);
    return buildEstateSummaryData(
      {
        years: projection.years,
        projection,
        clientData,
        scenarioLabel: "Base Case",
        clientName: "Client Test",
        spouseName: "Spouse Test",
      } as BuildDataContext,
      { ordering: "primaryFirst" },
    );
  };

  it("reports the gifts made to heirs by the last death beside the untouched estate breakdown", () => {
    // $19k a year to Alice for ten years, all before the 2050 final death.
    const withGifts = summaryOf(
      applyGiftsToClientData(
        buildMarriedEstateFixture(),
        [
          { kind: "series", id: "s-alice", startYear: 2026, endYear: 2035, annualAmount: 19_000,
            amountMode: "fixed", inflationAdjust: false, grantor: "client",
            recipient: { kind: "family_member", id: "kid-a" }, crummey: false },
        ],
        0.025,
      ),
    );
    const { kpis } = withGifts;

    expect(kpis.lifetimeGiftsEol).toBe(190_000);
    // The breakdown still describes the estate alone.
    expect(withGifts.chart[1].total).toBeCloseTo(kpis.grossEstateEol, 2);
    expect(kpis.shrinkageEol).toBeCloseTo(kpis.taxAndCostsEol / kpis.grossEstateEol, 6);
  });

  it("reports no gifts for a plan without any", () => {
    const { kpis } = summaryOf(buildMarriedEstateFixture());
    expect(kpis.lifetimeGiftsEol).toBe(0);
  });
});
