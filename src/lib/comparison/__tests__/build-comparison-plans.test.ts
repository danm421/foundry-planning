import { describe, it, expect, vi } from "vitest";
import { buildComparisonPlans } from "../build-comparison-plans";
import type { LoadedProjection } from "@/lib/scenario/load-projection-for-ref";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";

function fakeLoaded(name: string): LoadedProjection {
  return {
    tree: { client: { firstName: "F", lastName: "L", dateOfBirth: "1970-01-01" } } as never,
    result: { years: [], firstDeathEvent: undefined, secondDeathEvent: undefined } as never,
    scenarioName: name,
    isDoNothing: false,
  };
}

describe("buildComparisonPlans", () => {
  it("assembles N plans with index, isBaseline, label", async () => {
    const loaders = [
      vi.fn().mockResolvedValue(fakeLoaded("Base case")),
      vi.fn().mockResolvedValue(fakeLoaded("Roth Convert")),
      vi.fn().mockResolvedValue(fakeLoaded("Sell RE")),
    ];
    const plans = await buildComparisonPlans({
      refs: [
        { kind: "scenario", id: "base", toggleState: {} },
        { kind: "scenario", id: "sid_a", toggleState: {} },
        { kind: "scenario", id: "sid_b", toggleState: {} },
      ],
      loadProjection: (ref) => loaders[["base", "sid_a", "sid_b"].indexOf((ref as { id: string }).id)](),
      loadPanel: vi.fn().mockResolvedValue(null),
      buildEstateRows: vi.fn().mockReturnValue({ rows: [] as YearlyEstateRow[] }),
      buildLiquidityRows: vi.fn().mockReturnValue({ rows: [] }),
    });
    expect(plans).toHaveLength(3);
    expect(plans[0].index).toBe(0);
    expect(plans[0].isBaseline).toBe(true);
    expect(plans[1].isBaseline).toBe(false);
    expect(plans.map((p) => p.label)).toEqual(["Base case", "Roth Convert", "Sell RE"]);
  });

  it("derives id correctly for scenario, snapshot, base", async () => {
    const loadProjection = vi.fn().mockResolvedValue(fakeLoaded("X"));
    const plans = await buildComparisonPlans({
      refs: [
        { kind: "scenario", id: "base", toggleState: {} },
        { kind: "scenario", id: "sid_a", toggleState: {} },
        { kind: "snapshot", id: "snap_b", side: "left" },
      ],
      loadProjection,
      loadPanel: vi.fn().mockResolvedValue(null),
      buildEstateRows: vi.fn().mockReturnValue({ rows: [] }),
      buildLiquidityRows: vi.fn().mockReturnValue({ rows: [] }),
    });
    expect(plans[0].id).toBe("base");
    expect(plans[1].id).toBe("sid_a");
    expect(plans[2].id).toBe("snap:snap_b");
  });

  it("loads all plans in parallel (single Promise.all)", async () => {
    const order: number[] = [];
    const loaders = [
      () => new Promise<LoadedProjection>((r) => setTimeout(() => { order.push(0); r(fakeLoaded("A")); }, 20)),
      () => new Promise<LoadedProjection>((r) => setTimeout(() => { order.push(1); r(fakeLoaded("B")); }, 5)),
    ];
    let i = 0;
    await buildComparisonPlans({
      refs: [
        { kind: "scenario", id: "a", toggleState: {} },
        { kind: "scenario", id: "b", toggleState: {} },
      ],
      loadProjection: () => loaders[i++](),
      loadPanel: vi.fn().mockResolvedValue(null),
      buildEstateRows: vi.fn().mockReturnValue({ rows: [] }),
      buildLiquidityRows: vi.fn().mockReturnValue({ rows: [] }),
    });
    expect(order).toEqual([1, 0]); // B finishes before A → parallel, not sequential
  });
});
