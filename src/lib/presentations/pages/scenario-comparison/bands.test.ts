// src/lib/presentations/pages/scenario-comparison/bands.test.ts
import { describe, it, expect } from "vitest";
import { buildMetricRows, type ScenarioColumnInput } from "./metrics";
import { buildBadges } from "./badges";
import { buildTradeoffBands } from "./bands";

const base: ScenarioColumnInput = {
  refKey: "base", name: "Base Case", successRate: 0.73, endingP20: 600_000,
  atRetirement: 2_400_000, atEndOfLife: 4_400_000,
  lifetimeTaxTotal: 1_900_000, lifetimeTaxFederal: 1_400_000, lifetimeTaxState: 500_000,
  yearsFullyFunded: 28, netToHeirs: 3_100_000, maxSpendToday: 164_000,
};
const s1: ScenarioColumnInput = {
  ...base, refKey: "s1", name: "Retire at 62", successRate: 0.82, endingP20: 400_000,
  atRetirement: 2_100_000, atEndOfLife: 4_100_000, lifetimeTaxTotal: 2_042_000,
  yearsFullyFunded: 31, netToHeirs: 2_800_000, maxSpendToday: 182_000,
};
const rows = buildMetricRows({ columns: [base, s1], showMaxSpend: true });

describe("buildBadges", () => {
  it("gives each column at most two badges, in priority order", () => {
    const badges = buildBadges(rows, 2);
    expect(badges).toHaveLength(2);
    for (const b of badges) expect(b.length).toBeLessThanOrEqual(2);
    expect(badges[1]).toContain("Most spendable");   // s1 wins max spend
    expect(badges[0]).toContain("Lowest tax");       // base wins lifetime tax
  });
});

describe("buildTradeoffBands", () => {
  const bands = buildTradeoffBands({
    columns: [base, s1],
    rows,
    colors: ["#565c69", "#2d61aa"],
    changeLinesByScenario: {
      s1: ["Retirement age 65 to 62", "Savings 12% to 15%", "Add Roth conversion",
           "Trim travel", "Sell rental"],
    },
    narrativesByScenario: { s1: "Retiring earlier trades cushion for time." },
  });

  it("builds one band per scenario and none for Base Case", () => {
    expect(bands.map((b) => b.scenarioId)).toEqual(["s1"]);
  });

  it("caps the change list at four and counts the remainder", () => {
    expect(bands[0].changeLines).toHaveLength(4);
    expect(bands[0].moreChangeCount).toBe(1);
  });

  it("splits gains from costs by favourability, not by sign", () => {
    const g = bands[0].gains.map((x) => x.label);
    const c = bands[0].costs.map((x) => x.label);
    expect(g).toContain("Plan confidence");             // 73% to 82%, up = good
    expect(g).toContain("Max sustainable spending");
    expect(c).toContain("Lifetime taxes — total"); // tax UP = a cost
    expect(c).toContain("Assets end of life");          // assets DOWN = a cost
    expect(g).not.toContain("Lifetime taxes — total");
  });

  it("caps each side at three entries", () => {
    expect(bands[0].costs.length).toBeLessThanOrEqual(3);
    expect(bands[0].gains.length).toBeLessThanOrEqual(3);
  });

  it("never lists a federal or state sub-row beside its own total", () => {
    const labels = [...bands[0].gains, ...bands[0].costs].map((x) => x.label);
    expect(labels).not.toContain("federal");
    expect(labels).not.toContain("state");
  });

  it("carries the narrative through verbatim", () => {
    expect(bands[0].narrative).toBe("Retiring earlier trades cushion for time.");
  });

  it("leaves the narrative and change list empty when neither was supplied", () => {
    const none = buildTradeoffBands({
      columns: [base, s1], rows, colors: ["#565c69", "#2d61aa"],
      changeLinesByScenario: {}, narrativesByScenario: {},
    });
    expect(none[0].narrative).toBe("");
    expect(none[0].changeLines).toEqual([]);
  });
});
