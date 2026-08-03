// Migration 0229's decision logic. These cover the adopt and seed paths, which
// carry all of the migration's real logic and which production data does NOT
// exercise (`adopted = 0` and `seeded = 0` on the prod fork), so the only other
// evidence was a synthetic case on a throwaway Neon branch.
import { describe, expect, it } from "vitest";

import {
  cents,
  findLivingMoneyLoss,
  isAdoptable,
  isCanonicalWindow,
  planLivingScenario,
  type LivingRowFacts,
} from "../living-expenses-migration";
import { LIVING_CURRENT_NAME, LIVING_RETIREMENT_NAME } from "../living-expenses";

const T0 = new Date("2026-01-01T00:00:00Z");

function row(over: Partial<LivingRowFacts> = {}): LivingRowFacts {
  return {
    id: "r1",
    name: "Some Expense",
    annualAmount: "0",
    isDefault: false,
    startYearRef: null,
    endYearRef: null,
    growthSource: "inflation",
    createdAt: T0,
    ...over,
  };
}

const currentSlot = (over: Partial<LivingRowFacts> = {}) =>
  row({
    id: "cur",
    name: LIVING_CURRENT_NAME,
    isDefault: true,
    startYearRef: "plan_start",
    endYearRef: "client_retirement",
    ...over,
  });

const retirementSlot = (over: Partial<LivingRowFacts> = {}) =>
  row({
    id: "ret",
    name: LIVING_RETIREMENT_NAME,
    isDefault: true,
    startYearRef: "client_retirement",
    endYearRef: "plan_end",
    ...over,
  });

describe("cents", () => {
  it("avoids float drift so equal totals do not read as a decrease", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(cents("0.1") + cents("0.2")).toBe(cents("0.3"));
  });
});

describe("isCanonicalWindow", () => {
  it("accepts each role's canonical window", () => {
    expect(isCanonicalWindow(currentSlot(), "current")).toBe(true);
    expect(isCanonicalWindow(retirementSlot(), "retirement")).toBe(true);
  });

  it("accepts spouse_retirement as a Retirement start", () => {
    expect(
      isCanonicalWindow({ startYearRef: "spouse_retirement", endYearRef: "plan_end" }, "retirement"),
    ).toBe(true);
  });

  it("rejects a plan_start → plan_end row as a Current window", () => {
    // The overlap case: this would run through the whole plan and double-count
    // against a funded Retirement slot.
    expect(
      isCanonicalWindow({ startYearRef: "plan_start", endYearRef: "plan_end" }, "current"),
    ).toBe(false);
  });

  it("rejects a NULL-ref window", () => {
    expect(isCanonicalWindow({ startYearRef: null, endYearRef: null }, "current")).toBe(false);
  });
});

describe("isAdoptable", () => {
  it("accepts a non-default row with the role's canonical window", () => {
    expect(isAdoptable(row({ startYearRef: "plan_start", endYearRef: "client_retirement" }), "current")).toBe(true);
  });

  it("refuses a row whose window would overlap the other slot", () => {
    expect(isAdoptable(row({ startYearRef: "plan_start", endYearRef: "plan_end" }), "current")).toBe(false);
  });

  it("refuses a NULL-start_year_ref row — the dominant legacy shape", () => {
    expect(isAdoptable(row({ startYearRef: null, endYearRef: null }), "current")).toBe(false);
  });

  it("refuses a row whose role does not match the slot", () => {
    const r = row({ startYearRef: "plan_start", endYearRef: "client_retirement" });
    expect(isAdoptable(r, "retirement")).toBe(false);
  });

  it("refuses a row that is already a default slot", () => {
    expect(isAdoptable(currentSlot(), "current")).toBe(false);
  });
});

describe("planLivingScenario — seed path", () => {
  it("seeds both roles for a scenario with no living rows at all", () => {
    const plan = planLivingScenario([]);
    expect(plan.seed).toEqual(["current", "retirement"]);
    expect(plan.adopt).toEqual([]);
    expect(plan.livingCentsBefore).toBe(0);
    expect(plan.livingCentsAfter).toBe(0);
  });

  it("seeds both roles and reclassifies when the only rows are NULL-ref orphans", () => {
    // The 17-scenario dev shape, and the shape that trips the money guard.
    const orphan = row({ id: "o1", name: "Living Expenses", annualAmount: "90000" });
    const plan = planLivingScenario([orphan]);

    expect(plan.seed).toEqual(["current", "retirement"]);
    expect(plan.adopt).toEqual([]);
    expect(plan.reclassify.map((r) => r.id)).toEqual(["o1"]);
    expect(plan.livingCentsBefore).toBe(cents("90000"));
    expect(plan.livingCentsAfter).toBe(0);
  });

  it("seeds only the missing role", () => {
    const plan = planLivingScenario([currentSlot({ annualAmount: "50000" })]);
    expect(plan.seed).toEqual(["retirement"]);
  });
});

describe("planLivingScenario — adopt path", () => {
  it("adopts a canonical orphan instead of reclassifying it", () => {
    const orphan = row({
      id: "o1",
      name: "Household Spending",
      annualAmount: "88000",
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
    });
    const plan = planLivingScenario([orphan, retirementSlot()]);

    expect(plan.adopt).toEqual([{ row: orphan, role: "current" }]);
    expect(plan.seed).toEqual([]);
    expect(plan.reclassify).toEqual([]);
    // The money stays in the living bucket — this is the ordering guarantee.
    expect(plan.livingCentsAfter).toBe(plan.livingCentsBefore);
  });

  it("picks the largest amount, then the oldest, and reclassifies the rest", () => {
    const shape = { startYearRef: "plan_start", endYearRef: "client_retirement" } as const;
    const small = row({ id: "small", annualAmount: "40000", ...shape });
    const bigNewer = row({ id: "big-newer", annualAmount: "88000", createdAt: new Date("2026-06-01T00:00:00Z"), ...shape });
    const bigOlder = row({ id: "big-older", annualAmount: "88000", createdAt: new Date("2026-02-01T00:00:00Z"), ...shape });

    const plan = planLivingScenario([small, bigNewer, bigOlder, retirementSlot()]);

    expect(plan.adopt.map((a) => a.row.id)).toEqual(["big-older"]);
    expect(plan.reclassify.map((r) => r.id).sort()).toEqual(["big-newer", "small"]);
  });

  it("renames and re-sources an adopted row, and never renames a reclassified one", () => {
    const orphan = row({
      id: "o1",
      name: "Household Spending",
      annualAmount: "88000",
      growthSource: "custom",
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
    });
    const plan = planLivingScenario([orphan, retirementSlot()]);

    expect(plan.rename).toEqual([{ row: orphan, name: LIVING_CURRENT_NAME }]);
    expect(plan.forceGrowthSource.map((r) => r.id)).toEqual(["o1"]);
  });

  it("does NOT adopt into a slot that already exists, even an empty one", () => {
    // The `Sarah Friel` shape: two $0 slots plus a funded orphan. Adoption is
    // gated on slot presence, so the orphan is reclassified and the living
    // bucket empties — which is what the money guard is for.
    const orphan = row({ id: "o1", name: "Sarah Friel", annualAmount: "120000", startYearRef: "plan_start", endYearRef: "plan_end" });
    const plan = planLivingScenario([currentSlot({ annualAmount: "0" }), retirementSlot({ annualAmount: "0" }), orphan]);

    expect(plan.adopt).toEqual([]);
    expect(plan.reclassify.map((r) => r.id)).toEqual(["o1"]);
    expect(plan.livingCentsBefore).toBe(cents("120000"));
    expect(plan.livingCentsAfter).toBe(0);
  });
});

describe("planLivingScenario — growth_source is forced uniformly", () => {
  it("corrects a correctly-named default row that is still on custom", () => {
    // The 11-row prod case the name-gated version silently skipped.
    const plan = planLivingScenario([
      currentSlot({ growthSource: "custom" }),
      retirementSlot({ growthSource: "custom" }),
    ]);
    expect(plan.rename).toEqual([]);
    expect(plan.forceGrowthSource.map((r) => r.id).sort()).toEqual(["cur", "ret"]);
  });

  it("leaves rows already on inflation alone, so a re-run writes nothing", () => {
    const plan = planLivingScenario([currentSlot(), retirementSlot()]);
    expect(plan.forceGrowthSource).toEqual([]);
    expect(plan.rename).toEqual([]);
    expect(plan.adopt).toEqual([]);
    expect(plan.seed).toEqual([]);
    expect(plan.reclassify).toEqual([]);
  });

  it("does not touch reclassified rows", () => {
    const orphan = row({ id: "o1", annualAmount: "1000", growthSource: "custom" });
    const plan = planLivingScenario([currentSlot(), retirementSlot(), orphan]);
    expect(plan.forceGrowthSource).toEqual([]);
  });
});

describe("findLivingMoneyLoss", () => {
  const funded = () => [currentSlot({ annualAmount: "60000" }), retirementSlot({ annualAmount: "50000" })];

  it("returns nothing when every scenario keeps its living total", () => {
    const plans = [{ clientId: "c1", scenarioId: "s1", plan: planLivingScenario(funded()) }];
    expect(findLivingMoneyLoss(plans)).toEqual([]);
  });

  it("flags a scenario whose living bucket shrinks, listing the rows leaving", () => {
    const orphan = row({ id: "o1", name: "Sarah Friel", annualAmount: "120000" });
    const plans = [
      { clientId: "c1", scenarioId: "s1", plan: planLivingScenario(funded()) },
      {
        clientId: "c2",
        scenarioId: "s2",
        plan: planLivingScenario([currentSlot({ annualAmount: "0" }), retirementSlot({ annualAmount: "0" }), orphan]),
      },
    ];

    const loss = findLivingMoneyLoss(plans);
    expect(loss).toHaveLength(1);
    expect(loss[0].scenarioId).toBe("s2");
    expect(loss[0].livingCentsBefore).toBe(cents("120000"));
    expect(loss[0].livingCentsAfter).toBe(0);
    expect(loss[0].leaving.map((r) => r.name)).toEqual(["Sarah Friel"]);
  });

  it("does not flag a $0 row moving to other — no money leaves", () => {
    const zeroOrphan = row({ id: "o1", annualAmount: "0" });
    const plans = [
      { clientId: "c1", scenarioId: "s1", plan: planLivingScenario([...funded(), zeroOrphan]) },
    ];
    expect(findLivingMoneyLoss(plans)).toEqual([]);
  });

  it("flags a genuine extra leaving a fully funded scenario", () => {
    // The `Housing` shape: both slots funded, plus a real $23,284 extra. Money
    // still leaves the living bucket, so it is still Dan's call.
    const housing = row({ id: "h1", name: "Housing", annualAmount: "23284" });
    const plans = [
      { clientId: "c1", scenarioId: "s1", plan: planLivingScenario([...funded(), housing]) },
    ];
    const loss = findLivingMoneyLoss(plans);
    expect(loss).toHaveLength(1);
    expect(loss[0].leaving.map((r) => r.id)).toEqual(["h1"]);
  });
});
