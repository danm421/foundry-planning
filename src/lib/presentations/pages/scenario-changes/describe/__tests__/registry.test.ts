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

describe("insurance describers", () => {
  const std = { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null };
  const ltd = {
    eliminationDays: 90, benefitPct: 0.6, monthlyMax: 10000,
    benefitPeriod: { mode: "to_age", age: 65 },
  };
  const named = { targetNames: { "disability_policy:dp1": "Group disability" }, resolve: ctx.resolve };

  it("describes an added disability policy's coverage layers in the Insurance area", () => {
    const row = describeChange(ch({
      targetKind: "disability_policy", targetId: "dp1",
      payload: { id: "dp1", name: "Group disability", shortTerm: std, longTerm: ltd, annualPremium: 1200 },
    }), named);
    expect(row.area).toBe("Insurance");
    expect(row.what).toBe("+ Group disability");
    const d = row.detail.join(" ");
    expect(d).toContain("STD 60% · 13 wks");
    expect(d).toContain("LTD 60% to 65");
  });

  it("formats an edited coverage layer instead of printing a dash", () => {
    const row = describeChange(ch({
      targetKind: "disability_policy", targetId: "dp1", opType: "edit",
      payload: { shortTerm: { from: std, to: null } },
    }), named);
    expect(row.area).toBe("Insurance");
    expect(row.what).toBe("Group disability · Short term");
    expect(row.before).toBe("STD 60% · 13 wks");
    expect(row.after).toBe("None");
  });

  it("moves life insurance policies to the Insurance area", () => {
    const row = describeChange(ch({ targetKind: "life_insurance_policy", opType: "remove" }), ctx);
    expect(row.area).toBe("Insurance");
  });
});
