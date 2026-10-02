import { describe, it, expect } from "vitest";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import { growthSettingsOverride, stripGrowthSettingsKeys } from "../growth-settings-override";

const ps = (
  id: string,
  payload: Record<string, unknown>,
  orderIndex: number,
  toggleGroupId: string | null = null,
): ScenarioChange => ({
  id,
  scenarioId: "s",
  opType: "edit",
  targetKind: "plan_settings",
  targetId: "c",
  payload: Object.fromEntries(Object.entries(payload).map(([k, to]) => [k, { from: null, to }])),
  toggleGroupId,
  orderIndex,
});

const group = (id: string, defaultOn: boolean): ToggleGroup => ({
  id,
  scenarioId: "s",
  name: id,
  defaultOn,
  requiresGroupId: null,
  orderIndex: 0,
});

describe("growthSettingsOverride", () => {
  it("folds growth keys from active plan_settings edits in order", () => {
    expect(
      growthSettingsOverride(
        [
          ps("a", { defaultGrowthTaxable: 0.05, flatStateRate: 0.04 }, 0),
          ps("b", { defaultGrowthTaxable: 0.071234 }, 1),
        ],
        {},
        [],
      ),
    ).toEqual({ defaultGrowthTaxable: 0.0712 });
  });

  it("folds by orderIndex, not by array position", () => {
    expect(
      growthSettingsOverride(
        [ps("late", { inflationRate: 0.05 }, 2), ps("early", { inflationRate: 0.04 }, 1)],
        {},
        [],
      ),
    ).toEqual({ inflationRate: 0.05 });
  });

  it("ignores edits in a switched-off group", () => {
    const groups = [group("g", false)];
    expect(growthSettingsOverride([ps("a", { inflationRate: 0.04 }, 0, "g")], {}, groups)).toEqual({});
  });

  it("honours the toggle state over a group's default", () => {
    const groups = [group("g", true)];
    const changes = [ps("a", { inflationRate: 0.04 }, 0, "g")];
    expect(growthSettingsOverride(changes, { g: false }, groups)).toEqual({});
    expect(growthSettingsOverride(changes, { g: true }, groups)).toEqual({ inflationRate: 0.04 });
  });

  it("ignores an edit whose group is on but requires a group that is off", () => {
    const groups: ToggleGroup[] = [
      group("a", false),
      { ...group("b", true), requiresGroupId: "a" },
    ];
    const changes = [ps("x", { defaultGrowthTaxable: 0.09 }, 0, "b")];
    expect(growthSettingsOverride(changes, {}, groups)).toEqual({});
    // Control: switching the parent on lets the child's edit through.
    expect(growthSettingsOverride(changes, { a: true }, groups)).toEqual({ defaultGrowthTaxable: 0.09 });
  });

  it("returns {} when no edit carries a growth key", () => {
    expect(growthSettingsOverride([ps("a", { flatStateRate: 0.04 }, 0)], {}, [])).toEqual({});
  });

  it("rounds decimal strings after Number(); passes enum, id, boolean and null values through", () => {
    expect(
      growthSettingsOverride(
        [
          ps(
            "a",
            {
              defaultGrowthCash: "0.031249",
              inflationRateSource: "custom",
              growthSourceTaxable: "model_portfolio",
              modelPortfolioIdTaxable: "11111111-2222-3333-4444-555555555555",
              medicarePremiumInflationEnabled: false,
              taxInflationRate: null,
            },
            0,
          ),
        ],
        {},
        [],
      ),
    ).toEqual({
      defaultGrowthCash: 0.0312,
      inflationRateSource: "custom",
      growthSourceTaxable: "model_portfolio",
      modelPortfolioIdTaxable: "11111111-2222-3333-4444-555555555555",
      medicarePremiumInflationEnabled: false,
      taxInflationRate: null,
    });
  });

  it("reads only plan_settings edits", () => {
    const accountEdit: ScenarioChange = {
      ...ps("a", { defaultGrowthTaxable: 0.09 }, 0),
      targetKind: "account",
    };
    expect(growthSettingsOverride([accountEdit], {}, [])).toEqual({});
  });
});

describe("stripGrowthSettingsKeys", () => {
  it("strips growth keys and drops edits left empty", () => {
    const out = stripGrowthSettingsKeys([
      ps("a", { inflationRate: 0.04, flatStateRate: 0.05 }, 0),
      ps("b", { inflationRate: 0.03 }, 1),
    ]);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0].payload as object)).toEqual(["flatStateRate"]);
  });

  it("returns untouched changes by reference", () => {
    const plain = ps("a", { flatStateRate: 0.05 }, 0);
    const accountEdit: ScenarioChange = {
      ...ps("b", { defaultGrowthTaxable: 0.09 }, 1),
      targetKind: "account",
    };
    const out = stripGrowthSettingsKeys([plain, accountEdit]);
    expect(out[0]).toBe(plain);
    expect(out[1]).toBe(accountEdit);
  });
});
