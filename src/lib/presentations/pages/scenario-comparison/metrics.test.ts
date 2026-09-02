import { describe, it, expect } from "vitest";
import { buildMetricRows, type ScenarioColumnInput } from "./metrics";

function col(over: Partial<ScenarioColumnInput>): ScenarioColumnInput {
  return {
    refKey: "base",
    name: "Base Case",
    successRate: 0.73,
    endingP20: 600_000,
    atRetirement: 2_400_000,
    atEndOfLife: 4_400_000,
    retirementYear: 2050,
    endYear: 2075,
    lifetimeTaxTotal: 1_900_000,
    lifetimeTaxFederal: 1_400_000,
    lifetimeTaxState: 500_000,
    yearsFullyFunded: 28,
    netToHeirs: 3_100_000,
    maxSpendToday: 164_000,
    ...over,
  };
}

const COLUMNS: ScenarioColumnInput[] = [
  col({}),
  col({ refKey: "s1", name: "Retire at 62", successRate: 0.82, endingP20: 400_000,
        atRetirement: 2_100_000, atEndOfLife: 4_100_000, lifetimeTaxTotal: 2_000_000,
        lifetimeTaxFederal: 1_500_000, lifetimeTaxState: 500_001, yearsFullyFunded: 31,
        netToHeirs: 2_800_000, maxSpendToday: 182_000 }),
  col({ refKey: "s2", name: "Work to 67", successRate: 0.94, endingP20: 1_700_000,
        atRetirement: 3_000_000, atEndOfLife: 6_200_000, lifetimeTaxTotal: 2_400_000,
        lifetimeTaxFederal: 1_800_000, lifetimeTaxState: 600_000, yearsFullyFunded: 35,
        netToHeirs: 4_800_000, maxSpendToday: 158_000 }),
];

const rowsOf = (over: Partial<Parameters<typeof buildMetricRows>[0]> = {}) =>
  buildMetricRows({ columns: COLUMNS, showMaxSpend: true, ...over });

const row = (label: string) => {
  const r = rowsOf().find((x) => x.label === label);
  if (!r) throw new Error(`no row ${label}`);
  return r;
};

describe("buildMetricRows", () => {
  it("reads each column's own value for every row", () => {
    expect(row("Plan confidence").cells.map((c) => c.value)).toEqual(["73%", "82%", "94%"]);
    expect(row("Assets at retirement").cells.map((c) => c.value))
      .toEqual(["$2.4M", "$2.1M", "$3.0M"]);
    expect(row("Years fully funded").cells.map((c) => c.value)).toEqual(["28", "31", "35"]);
  });

  it("leaves the base column without a delta", () => {
    for (const r of rowsOf()) expect(r.cells[0].delta).toBeNull();
  });

  it("signs deltas against the base column", () => {
    expect(row("Plan confidence").cells[1].delta).toBe("+9 pts");
    expect(row("Assets end of life").cells[2].delta).toBe("+$1.8M");
    expect(row("Assets at retirement").cells[1].delta).toBe("−$300k");
  });

  // The single most important assertion in this file: a FALLING lifetime tax
  // is a GAIN. Colour is taken from betterIs, never from the delta's sign.
  it("colours a lower lifetime tax as favourable", () => {
    const tax = row("Lifetime taxes — total");
    expect(tax.betterIs).toBe("lower");
    expect(tax.cells[1].direction).toBe(-1); // 2.0M vs 1.9M — worse
    const cheaper = buildMetricRows({
      columns: [COLUMNS[0], { ...COLUMNS[1], lifetimeTaxTotal: 1_600_000 }],
      showMaxSpend: true,
    }).find((r) => r.label === "Lifetime taxes — total")!;
    expect(cheaper.cells[1].direction).toBe(1); // cheaper — better
  });

  it("marks the best column per row, honouring betterIs", () => {
    expect(row("Plan confidence").cells.map((c) => c.isBest)).toEqual([false, false, true]);
    expect(row("Lifetime taxes — total").cells.map((c) => c.isBest))
      .toEqual([true, false, false]);
  });

  it("hides the max-spend row when the option is off", () => {
    const labels = rowsOf({ showMaxSpend: false }).map((r) => r.label);
    expect(labels).not.toContain("Max sustainable spending");
  });

  it("drops the state row when no column pays state tax", () => {
    const noState = buildMetricRows({
      columns: COLUMNS.map((c) => ({ ...c, lifetimeTaxState: 0 })),
      showMaxSpend: true,
    });
    expect(noState.map((r) => r.label)).not.toContain("state");
  });

  it("prints an em-dash and no delta when Monte Carlo is unavailable", () => {
    const rows = buildMetricRows({
      columns: [{ ...COLUMNS[0], successRate: null, endingP20: null }, COLUMNS[1]],
      showMaxSpend: true,
    });
    const conf = rows.find((r) => r.label === "Plan confidence")!;
    expect(conf.cells[0].value).toBe("—");
    expect(conf.cells[1].delta).toBeNull();
    expect(conf.cells[1].direction).toBe(0);
  });

  it("excludes an unavailable value from the best-column choice", () => {
    const rows = buildMetricRows({
      columns: [{ ...COLUMNS[0], successRate: null }, COLUMNS[1]],
      showMaxSpend: true,
    });
    const conf = rows.find((r) => r.label === "Plan confidence")!;
    expect(conf.cells.map((c) => c.isBest)).toEqual([false, true]);
  });
});
