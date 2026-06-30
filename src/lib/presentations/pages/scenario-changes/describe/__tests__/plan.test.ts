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

describe("relocation describer", () => {
  const reloc = (p: Partial<ScenarioChange>): ScenarioChange =>
    ch({ targetKind: "relocation", targetId: "r1", ...p });

  it("add spells out the destination state and year", () => {
    const row = describeChange(
      reloc({ opType: "add", payload: { id: "r1", name: "Move to Florida", destinationState: "FL", year: 2030 } }),
      ctx,
    );
    expect(row.area).toBe("Plan & Assumptions");
    expect(row.op).toBe("add");
    expect(row.detail.join(" ")).toBe("Moves to Florida in 2030");
  });

  it("add degrades to a year-only line when the state is missing", () => {
    const row = describeChange(reloc({ opType: "add", payload: { year: 2032 } }), ctx);
    expect(row.detail.join(" ")).toMatch(/2032/);
  });

  it("edit shows full state names, not raw USPS codes", () => {
    const row = describeChange(
      reloc({ opType: "edit", payload: { destinationState: { from: "FL", to: "TX" } } }),
      ctx,
    );
    expect(row.op).toBe("edit");
    expect(row.before).toBe("Florida");
    expect(row.after).toBe("Texas");
  });

  it("remove reads as removed", () => {
    const row = describeChange(reloc({ opType: "remove", payload: null }), ctx);
    expect(row.op).toBe("remove");
    expect(row.after).toBe("Removed");
  });
});
