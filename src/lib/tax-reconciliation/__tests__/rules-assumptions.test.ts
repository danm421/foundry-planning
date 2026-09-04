import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { assumptionRules } from "../rules/assumptions";
import { inputFixture, planFixture } from "./fixtures";

describe("assumptionRules — carryover.capitalLoss", () => {
  it("writes the worksheet figure to the long-term carryforward when it differs by more than $100", () => {
    const f = emptyTaxReturnFacts(2025);
    f.carryovers.capitalLossCarryover = 12_000;
    const plan = planFixture({ planSettings: { ...planFixture().planSettings, capitalLossCarryforwardLt: 8_000, capitalLossCarryforwardSt: 500 } });
    const s = assumptionRules(inputFixture({ facts: f, plan })).suggestions.find((x) => x.id === "carryover.capitalLoss")!;
    expect(s.action?.target).toEqual({ kind: "plan_settings.update", patch: { capitalLossCarryforwardLt: 12_000 }, amountField: "capitalLossCarryforwardLt" });
    expect(s.action?.amountEditable).toBe(true);
    expect(s.returnFigure.display).toBe("$12,000");
    expect(s.planFigure.amount).toBe(8_500);          // Lt + St
    expect(s.planFigure.display).toBe("$8,500");
    // Ordered: the return's figure comes first. Swapping the two sides fails this.
    expect(s.headline).toMatch(/carries \$12,000 .*starts with \$8,500\./);
    expect(s.meaning).toMatch(/does not split/i);      // the worksheet caveat
  });

  it("reads a negative extracted carryover as the magnitude it is", () => {
    const f = emptyTaxReturnFacts(2025);
    f.carryovers.capitalLossCarryover = -12_000;       // the schema's `money` has no .min(0)
    const plan = planFixture({ planSettings: { ...planFixture().planSettings, capitalLossCarryforwardLt: 8_000 } });
    const s = assumptionRules(inputFixture({ facts: f, plan })).suggestions.find((x) => x.id === "carryover.capitalLoss")!;
    expect(s.returnFigure.amount).toBe(12_000);
    expect(s.returnFigure.display).toBe("$12,000");
    expect(s.action?.defaultAmount).toBe(12_000);
    expect(s.action?.target).toEqual({ kind: "plan_settings.update", patch: { capitalLossCarryforwardLt: 12_000 }, amountField: "capitalLossCarryforwardLt" });
    expect(s.headline).not.toContain("-$");
  });

  it("is in line within $100", () => {
    const f = emptyTaxReturnFacts(2025);
    f.carryovers.capitalLossCarryover = 8_050;
    const plan = planFixture({ planSettings: { ...planFixture().planSettings, capitalLossCarryforwardLt: 8_000 } });
    const r = assumptionRules(inputFixture({ facts: f, plan }));
    expect(r.suggestions.find((x) => x.id === "carryover.capitalLoss")).toBeUndefined();
    // The whole row: the two sides differ here, so a returnDisplay/planDisplay swap fails this.
    expect(r.checks.find((c) => c.id === "carryover.capitalLoss")).toEqual({
      id: "carryover.capitalLoss", label: "Capital loss carryforward", returnDisplay: "$8,050", planDisplay: "$8,000",
    });
  });
});

describe("assumptionRules — medicare.priorYearMagi", () => {
  const magiFacts = () => {
    const f = emptyTaxReturnFacts(2025);
    f.filingStatus = "married_joint";
    f.income.agi = 180_000;
    f.income.taxExemptInterest = 12_000;
    return f;
  };

  it("upserts MAGI (AGI + tax-exempt interest) for each person 63 or older, per owner", () => {
    // client born 1960 → 65 in 2025; spouse born 1962 → 63
    const r = assumptionRules(inputFixture({ facts: magiFacts() }));
    const client = r.suggestions.find((s) => s.id === "medicare.priorYearMagi.client")!;
    const spouse = r.suggestions.find((s) => s.id === "medicare.priorYearMagi.spouse")!;
    expect(client.action?.target).toEqual({ kind: "medicare.upsert", owner: "client", priorYearMagi: 192_000, amountField: "priorYearMagi" });
    expect(spouse.action?.target).toMatchObject({ owner: "spouse", priorYearMagi: 192_000 });
    expect(client.returnFigure.lineRefs.map((l) => l.line)).toEqual(["11", "2a"]);
    expect(client.returnFigure.lineRefs.map((l) => l.amount)).toEqual([180_000, 12_000]);
  });

  it("does not offer the spouse's MAGI on a return that is not joint", () => {
    // A married-separate return states one spouse's income alone, so `agi + taxExemptInterest`
    // is not the spouse's IRMAA MAGI — even though the plan has a spouse DOB and she is 63.
    const f = magiFacts();
    f.filingStatus = "married_separate";
    const r = assumptionRules(inputFixture({ facts: f }));
    expect(r.suggestions.map((s) => s.id)).toEqual(["medicare.priorYearMagi.client"]);
    expect(r.checks.map((c) => c.id)).not.toContain("medicare.priorYearMagi.spouse");
  });

  it("suggests when the plan's stored MAGI is stale by more than the row tolerance", () => {
    const plan = planFixture({ medicare: [{ owner: "client", priorYearMagi: 120_000 }] });
    const r = assumptionRules(inputFixture({ facts: magiFacts(), plan }));
    const s = r.suggestions.find((x) => x.id === "medicare.priorYearMagi.client")!;
    expect(s.returnFigure.display).toBe("$192,000");
    expect(s.planFigure.amount).toBe(120_000);
    expect(s.planFigure.display).toBe("$120,000");
    expect(s.action?.target).toEqual({ kind: "medicare.upsert", owner: "client", priorYearMagi: 192_000, amountField: "priorYearMagi" });
    expect(s.action?.defaultAmount).toBe(192_000);
    expect(s.delta).toEqual({ amount: -72_000, display: "Plan is $72,000 short", tone: "short" });
    // Ordered: the return's figure comes first. Swapping the two sides fails this.
    expect(s.headline).toMatch(/MAGI is \$192,000;.*lookback at \$120,000\./);
    expect(r.checks.map((c) => c.id)).not.toContain("medicare.priorYearMagi.client");
  });

  it("skips a person under 63 and checks a row already within tolerance", () => {
    const plan = planFixture({ client: { filingStatus: "married_joint", dateOfBirth: "1960-04-02", spouseDob: "1970-01-01" }, medicare: [{ owner: "client", priorYearMagi: 191_000 }] });
    const r = assumptionRules(inputFixture({ facts: magiFacts(), plan }));
    expect(r.suggestions.map((s) => s.id)).not.toContain("medicare.priorYearMagi.spouse");
    expect(r.checks.map((c) => c.id)).not.toContain("medicare.priorYearMagi.spouse");
    // $1,000 clears the $500 floor but not 5% of $192,000, so this row is in line.
    // The whole row: the two sides differ here, so a swap of the displays fails this.
    expect(r.checks.find((c) => c.id === "medicare.priorYearMagi.client")).toEqual({
      id: "medicare.priorYearMagi.client", label: "Medicare MAGI (the client)", returnDisplay: "$192,000", planDisplay: "$191,000",
    });
  });
});
