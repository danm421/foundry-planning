import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";
import type { ScenarioChange } from "@/engine/scenario/types";

const resolve = buildResolveContext({
  accountsById: { a1: { name: "Roth 401(k)", category: "retirement", subType: "roth_401k" } },
  recipientsById: {}, entitiesById: {}, spouseName: "Susan",
  modelPortfoliosById: {}, baseAllocationsById: {},
});
const ctx = { targetNames: { "savings_rule:s1": "401(k) contribution" }, resolve };
const ch = (p: Partial<ScenarioChange>): ScenarioChange => ({
  id: "c", scenarioId: "s", opType: "add", targetKind: "savings_rule",
  targetId: "s1", payload: {}, toggleGroupId: null, orderIndex: 0, ...p,
});

describe("savings_rule describer", () => {
  it("adds with account, amount, roth %, match, window", () => {
    const row = describeChange(ch({ payload: {
      accountId: "a1", annualAmount: 20000, rothPercent: 1,
      employerMatchPct: 0.5, employerMatchCap: 0.06, startYear: 2026, endYear: 2031,
    } }), ctx);
    const d = row.detail.join(" ");
    expect(row.area).toBe("Savings");
    expect(d).toContain("Roth 401(k)");
    expect(d).toContain("$20k/yr");
    expect(d).toContain("100% Roth");
    expect(d).toContain("match 50% to 6%");
    expect(d).toContain("2026");
  });
  it("edit shows account context + field change", () => {
    const row = describeChange(ch({ opType: "edit", payload: { annualAmount: { from: 20000, to: 25000 } } }), ctx);
    expect(row.detail.join(" ")).toContain("$20k → $25k");
  });
});
