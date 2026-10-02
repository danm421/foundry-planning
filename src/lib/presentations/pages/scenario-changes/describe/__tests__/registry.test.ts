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
    expect(d).toContain("LTD 60% to age 65");
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

  // The stored token for the second person must never reach a client page.
  it("names the insured person on an edit instead of printing the stored token", () => {
    const row = describeChange(ch({
      targetKind: "disability_policy", targetId: "dp1", opType: "edit",
      payload: { insured: { from: "client", to: "spouse" } },
    }), named);
    expect(row.before).toBe("Client");
    expect(row.after).toBe("Co-client");
  });

  it("names a life-insurance account's insured person on an account edit", () => {
    const row = describeChange(ch({
      targetKind: "account", opType: "edit",
      payload: { insuredPerson: { from: "spouse", to: "joint" } },
    }), ctx);
    expect(row.before).toBe("Co-client");
    expect(row.after).toBe("Joint");
  });

  it("formats money and rate edits instead of printing bare numbers", () => {
    const premium = describeChange(ch({
      targetKind: "disability_policy", targetId: "dp1", opType: "edit",
      payload: { annualPremium: { from: 1200, to: 900 } },
    }), named);
    expect(premium.what).toBe("Group disability · Annual premium");
    expect(premium.before).toBe("$1.2k");
    expect(premium.after).toBe("$900");

    const cola = describeChange(ch({
      targetKind: "disability_policy", targetId: "dp1", opType: "edit",
      payload: { colaRate: { from: 0, to: 0.03 } },
    }), named);
    expect(cola.before).toBe("0%");
    expect(cola.after).toBe("3%");
  });

  it("moves life insurance policies to the Insurance area", () => {
    const row = describeChange(ch({ targetKind: "life_insurance_policy", opType: "remove" }), ctx);
    expect(row.area).toBe("Insurance");
  });
});
