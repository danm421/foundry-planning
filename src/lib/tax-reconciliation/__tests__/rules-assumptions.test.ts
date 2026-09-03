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
    expect(s.planFigure.amount).toBe(8_500);          // Lt + St
    expect(s.meaning).toMatch(/does not split/i);      // the worksheet caveat
  });

  it("is in line within $100", () => {
    const f = emptyTaxReturnFacts(2025);
    f.carryovers.capitalLossCarryover = 8_050;
    const plan = planFixture({ planSettings: { ...planFixture().planSettings, capitalLossCarryforwardLt: 8_000 } });
    const r = assumptionRules(inputFixture({ facts: f, plan }));
    expect(r.suggestions.find((x) => x.id === "carryover.capitalLoss")).toBeUndefined();
    expect(r.checks.map((c) => c.id)).toContain("carryover.capitalLoss");
  });
});

describe("assumptionRules — medicare.priorYearMagi", () => {
  const magiFacts = () => {
    const f = emptyTaxReturnFacts(2025);
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
  });

  it("skips a person under 63 and checks a row already within tolerance", () => {
    const plan = planFixture({ client: { filingStatus: "married_joint", dateOfBirth: "1960-04-02", spouseDob: "1970-01-01" }, medicare: [{ owner: "client", priorYearMagi: 191_000 }] });
    const r = assumptionRules(inputFixture({ facts: magiFacts(), plan }));
    expect(r.suggestions.map((s) => s.id)).not.toContain("medicare.priorYearMagi.spouse");
    expect(r.checks.map((c) => c.id)).toContain("medicare.priorYearMagi.client");
  });
});
