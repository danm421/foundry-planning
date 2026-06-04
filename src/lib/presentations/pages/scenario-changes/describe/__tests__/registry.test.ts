import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext, EMPTY_RESOLVE_DATA } from "../resolve";
import type { ScenarioChange } from "@/engine/scenario/types";

const ctx = { targetNames: {}, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) };
const ch = (p: Partial<ScenarioChange>): ScenarioChange => ({
  id: "c", scenarioId: "s", opType: "add", targetKind: "savings_rule",
  targetId: "t", payload: {}, toggleGroupId: null, orderIndex: 0, ...p,
});

describe("registry dispatch", () => {
  it("routes savings_rule to a describer that reads the payload", () => {
    const row = describeChange(
      ch({ targetKind: "savings_rule", payload: { accountId: "a1", annualAmount: 20000 } }), ctx);
    expect(row.area).toBe("Savings");
    expect(row.op).toBe("add");
  });
  it("falls back gracefully for an unknown kind", () => {
    const row = describeChange(ch({ targetKind: "totally_new" as never }), ctx);
    expect(row.what.length).toBeGreaterThan(0);
  });
});
