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

describe("LTC policy describer", () => {
  const LIFE_ID = "9f1c2d3e-4b5a-4789-abcd-ef0123456789";
  const named = {
    targetNames: { "ltc_policy:l1": "Genworth LTC" },
    resolve: buildResolveContext({
      ...EMPTY_RESOLVE_DATA,
      accountsById: { [LIFE_ID]: { name: "Whole Life", category: "life_insurance" } },
    }),
  };
  const payload = {
    id: "l1", name: "Genworth LTC", insured: "client", carrier: null, kind: "standalone",
    lifePolicyAccountId: null, issueYear: 2026, benefitAmount: 6000, benefitUnit: "month",
    riderBenefitMode: null, riderMonthlyPct: null, benefitPeriodMode: "years", benefitPeriodYears: 3,
    riderMaxPct: null, extensionYears: 0, residualDeathBenefit: 0, eliminationDays: 90, homeCarePct: 1,
    inflationRider: "compound", inflationRate: 0.03, benefitType: "reimbursement", sharedCare: false,
    annualPremium: 2400, premiumPayMode: "lifetime", premiumPayToAge: null, premiumPayYears: null,
    partnership: false, notes: null,
  };

  it("describes an added policy in the Insurance area in the panel's words", () => {
    const row = describeChange(ch({ targetKind: "ltc_policy", targetId: "l1", payload }), named);
    expect(row.area).toBe("Insurance");
    expect(row.what).toBe("+ Genworth LTC");
    expect(row.detail.join(" ")).toBe("Traditional · $6,000/mo · 3 yrs · $2,400/yr for life");
  });

  it("formats money and rate edits instead of printing bare numbers", () => {
    const premium = describeChange(ch({
      targetKind: "ltc_policy", targetId: "l1", opType: "edit",
      payload: { annualPremium: { from: 900, to: 2100 } },
    }), named);
    // The generic formatter prints 900 bare and reads 2100 as a year.
    expect([premium.before, premium.after]).toEqual(["$900", "$2,100"]);
    const rate = describeChange(ch({
      targetKind: "ltc_policy", targetId: "l1", opType: "edit",
      payload: { inflationRate: { from: 0.03, to: 0.05 } },
    }), named);
    expect([rate.before, rate.after]).toEqual(["3%", "5%"]);
  });

  it("words a Traditional → Rider switch without stored codes or the life policy's id", () => {
    const row = describeChange(ch({
      targetKind: "ltc_policy", targetId: "l1", opType: "edit",
      payload: {
        kind: { from: "standalone", to: "life_rider" },
        riderBenefitMode: { from: null, to: "pct_of_face" },
        premiumPayMode: { from: "lifetime", to: "paid_up" },
        lifePolicyAccountId: { from: null, to: LIFE_ID },
      },
    }), named);
    const text = row.detail.join(" | ");
    for (const code of ["standalone", "life_rider", "pct_of_face", "paid_up"]) expect(text).not.toContain(code);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).toContain("Kind: Traditional → Rider");
    expect(text).toContain("Life policy: — → Whole Life");
  });

  it("names a life policy this scenario added, and never prints an id it cannot name", () => {
    const edit = (to: string, targetNames: Record<string, string>) => describeChange(ch({
      targetKind: "ltc_policy", targetId: "l1", opType: "edit",
      payload: { lifePolicyAccountId: { from: LIFE_ID, to } },
    }), { ...named, targetNames: { ...named.targetNames, ...targetNames } });
    const added = edit("new-life", { "account:new-life": "Survivorship" });
    expect(added.what).toBe("Genworth LTC · Life policy");
    expect([added.before, added.after]).toEqual(["Whole Life", "Survivorship"]);
    expect(edit("gone", {}).after).toBe("A life policy");
  });

  it("reads switches as Yes / No", () => {
    const row = describeChange(ch({
      targetKind: "ltc_policy", targetId: "l1", opType: "edit",
      payload: { sharedCare: { from: false, to: true } },
    }), named);
    expect([row.before, row.after]).toEqual(["No", "Yes"]);
  });

  it("names the life policy on an added rider, as the panel does", () => {
    const rider = {
      ...payload, kind: "life_rider", lifePolicyAccountId: LIFE_ID, benefitAmount: 0,
      riderBenefitMode: "pct_of_face", riderMonthlyPct: 0.02, benefitPeriodMode: null, benefitPeriodYears: null,
      riderMaxPct: 1, inflationRider: "none", annualPremium: 0, premiumPayMode: "paid_up",
    };
    const row = describeChange(ch({ targetKind: "ltc_policy", targetId: "l1", payload: rider }), named);
    expect(row.detail.join(" ")).toBe("Rider on Whole Life · 2% of the death benefit/mo");
  });
});
