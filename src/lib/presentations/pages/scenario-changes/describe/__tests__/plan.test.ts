import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext, EMPTY_RESOLVE_DATA } from "../resolve";
import type { ScenarioChange } from "@/engine/scenario/types";

const ctx = { targetNames: {}, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) };
const ch = (p: Partial<ScenarioChange>): ScenarioChange => ({
  id: "c", scenarioId: "s", opType: "edit", targetKind: "client",
  targetId: "p1", payload: {}, toggleGroupId: null, orderIndex: 0, ...p });

describe("plan describers", () => {
  it("client retirementAge edit reads as a plain-language line", () => {
    const row = describeChange(ch({ payload: { retirementAge: { from: 65, to: 67 } } }), ctx);
    expect(row.what).toBe("Retirement age");
    expect(row.before).toBe("65");
    expect(row.after).toBe("67");
    expect(row.detail.join(" ")).toMatch(/retires? at 67/i);
  });
});
