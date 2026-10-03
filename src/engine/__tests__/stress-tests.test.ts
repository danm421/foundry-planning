import { describe, it, expect } from "vitest";
import { applyStressTests, withStressTest, STRESS_TEST_IDS } from "../stress-tests";
import { basePlanSettings, buildClientData } from "./fixtures";
import type { StressTest, StressTestParams } from "../types";

describe("withStressTest", () => {
  const cases: [StressTestParams, Record<string, unknown>][] = [
    [{ kind: "inflation", rate: 0.05 }, { livingExpenseInflationOverride: 0.05 }],
    [{ kind: "ss-haircut", pct: 0.23, startYear: 2034 }, { ssBenefitHaircut: { pct: 0.23, startYear: 2034 } }],
    [{ kind: "tax-rates", points: 0.03, startYear: 2027 }, { taxRateStress: { points: 0.03, startYear: 2027 } }],
    [
      { kind: "disability", person: "spouse", startYear: 2027, endYear: 2030 },
      { disabilityEvent: { person: "spouse", startYear: 2027, endYear: 2030 } },
    ],
    [{ kind: "market-crash", year: 2027, drawdownPct: 0.3 }, { marketShock: { year: 2027, drawdownPct: 0.3 } }],
    [{ kind: "exemption-cap", cap: 7_000_000 }, { lifetimeExemptionCap: 7_000_000 }],
  ];

  it.each(cases)("%o writes its plan setting and nothing else", (t, expected) => {
    expect(withStressTest(basePlanSettings, t)).toEqual({ ...basePlanSettings, ...expected });
  });

  it("returns a new object and leaves the input untouched", () => {
    const before = structuredClone(basePlanSettings);
    const out = withStressTest(basePlanSettings, { kind: "market-crash", year: 2027, drawdownPct: 0.3 });
    expect(out).not.toBe(basePlanSettings);
    expect(basePlanSettings).toEqual(before);
  });
});

describe("applyStressTests", () => {
  it("folds every saved stressor into planSettings", () => {
    const tests: StressTest[] = [
      { kind: "market-crash", year: 2027, drawdownPct: 0.3, id: STRESS_TEST_IDS["market-crash"], name: "Market crash — 30% in 2027" },
      { kind: "inflation", rate: 0.05, id: STRESS_TEST_IDS.inflation, name: "Higher inflation — 5% a year" },
    ];
    const tree = buildClientData({ stressTests: tests });
    applyStressTests(tree);
    expect(tree.planSettings.marketShock).toEqual({ year: 2027, drawdownPct: 0.3 });
    expect(tree.planSettings.livingExpenseInflationOverride).toBe(0.05);
  });

  it("is a no-op when the tree holds no stress tests", () => {
    const tree = buildClientData();
    const before = structuredClone(tree.planSettings);
    applyStressTests(tree);
    expect(tree.planSettings).toEqual(before);
  });
});

describe("STRESS_TEST_IDS", () => {
  it("is six distinct v4 uuids, one per kind", () => {
    const ids = Object.values(STRESS_TEST_IDS);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
