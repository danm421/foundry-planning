import { describe, it, expect } from "vitest";
import { estateChartBar } from "../view-model";
import type { EstateSummaryHousehold } from "../aggregate";

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
