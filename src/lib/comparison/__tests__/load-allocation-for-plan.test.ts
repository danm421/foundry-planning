import { describe, it, expect } from "vitest";
import { loadAllocationForPlan } from "../load-allocation-for-plan";
import type { LoadedProjection } from "@/lib/scenario/load-projection-for-ref";

describe("loadAllocationForPlan", () => {
  it("returns null when no investable accounts exist", async () => {
    const loaded: LoadedProjection = {
      scenarioName: "x",
      tree: {
        client: {},
        accounts: [],
        incomes: [],
        expenses: [],
        liabilities: [],
        savingsRules: [],
        withdrawalStrategy: [],
        planSettings: {} as never,
        giftEvents: [],
      } as never,
      result: { years: [] } as never,
      isDoNothing: false,
    };
    const out = await loadAllocationForPlan({
      clientId: "c1",
      firmId: "f1",
      loaded,
    });
    expect(out).toBeNull();
  });
});
