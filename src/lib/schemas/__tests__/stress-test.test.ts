import { describe, it, expect } from "vitest";
import { stressTestSchema } from "../stress-test";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";
import { MAX_RATE_STRESS_POINTS } from "@/lib/tax/rate-stress";

const crash = {
  kind: "market-crash", year: 2027, drawdownPct: 0.3,
  id: STRESS_TEST_IDS["market-crash"], name: "Market crash — 30% in 2027",
};

describe("stressTestSchema", () => {
  it.each([
    { kind: "inflation", rate: 0.05 },
    { kind: "ss-haircut", pct: 0.23, startYear: 2034 },
    { kind: "tax-rates", points: 0.03, startYear: 2027 },
    { kind: "disability", person: "client", startYear: 2027, endYear: null },
    { kind: "market-crash", year: 2027, drawdownPct: 0.3 },
    { kind: "exemption-cap", cap: 7_000_000 },
  ] as const)("accepts a $kind carrying its fixed id", (params) => {
    const r = stressTestSchema.safeParse({ ...params, id: STRESS_TEST_IDS[params.kind], name: "x" });
    expect(r.success).toBe(true);
  });

  it("refuses a stressor carrying another kind's id — one of each kind per scenario", () => {
    expect(stressTestSchema.safeParse({ ...crash, id: STRESS_TEST_IDS.inflation }).success).toBe(false);
  });

  it.each([
    ["drawdown over 100%", { ...crash, drawdownPct: 1.2 }],
    ["a year out of range", { ...crash, year: 1800 }],
    ["an unknown kind", { ...crash, kind: "meteor" }],
    ["a blank name", { ...crash, name: "  " }],
    [
      "tax points over the ceiling",
      { kind: "tax-rates", points: MAX_RATE_STRESS_POINTS + 0.01, startYear: 2027, id: STRESS_TEST_IDS["tax-rates"], name: "x" },
    ],
  ])("refuses %s", (_label, value) => {
    expect(stressTestSchema.safeParse(value).success).toBe(false);
  });

  it("strips unknown keys", () => {
    const r = stressTestSchema.parse({ ...crash, notAField: 1 });
    expect(r).toEqual(crash);
  });
});
