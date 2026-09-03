import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { householdRules } from "../rules/household";
import { CLIENT_ID, inputFixture, planFixture } from "./fixtures";

const facts = () => {
  const f = emptyTaxReturnFacts(2025);
  f.filingStatus = "married_joint";
  f.residenceState = "PA";
  f.dependentsUnder17 = 0;
  return f;
};
const ids = (r: { suggestions: { id: string }[] }) => r.suggestions.map((s) => s.id);

describe("householdRules", () => {
  it("emits three in-line checks when filing status, state and dependents all agree", () => {
    const r = householdRules(inputFixture({ facts: facts() }));
    expect(ids(r)).toEqual([]);
    expect(r.checks.map((c) => c.id)).toEqual(["household.filingStatus", "household.residenceState", "household.dependents"]);
  });

  it("suggests the return's filing status as a client.update", () => {
    const r = householdRules(inputFixture({ facts: facts(), plan: planFixture({ client: { filingStatus: "single", dateOfBirth: "1960-04-02", spouseDob: null } }) }));
    const s = r.suggestions.find((x) => x.id === "household.filingStatus")!;
    expect(s.kind).toBe("update");
    expect(s.section).toBe("household");
    expect(s.action?.target).toEqual({ kind: "client.update", patch: { filingStatus: "married_joint" } });
    expect(s.action?.amountEditable).toBe(false);
    expect(s.returnFigure.display).toBe("Married filing jointly");
    expect(s.planFigure.display).toBe("Single");
  });

  it("suggests residence state when the plan has none or a different one", () => {
    const none = householdRules(inputFixture({ facts: facts(), plan: planFixture({ planSettings: { ...planFixture().planSettings, residenceState: null } }) }));
    expect(none.suggestions.find((s) => s.id === "household.residenceState")?.action?.target).toEqual({ kind: "plan_settings.update", patch: { residenceState: "PA" } });
    const other = householdRules(inputFixture({ facts: facts(), plan: planFixture({ planSettings: { ...planFixture().planSettings, residenceState: "NJ" } }) }));
    expect(other.suggestions.find((s) => s.id === "household.residenceState")?.headline).toMatch(/PA/);
  });

  it("counts dependents the way the return does and sends a mismatch to Profile", () => {
    const f = facts();
    f.dependentsUnder17 = 2;
    f.dependents17to23 = 0;
    const plan = planFixture();
    plan.familyMembers.push(
      { id: "k1", role: "child", relationship: "child", dateOfBirth: "2015-01-01", claimedAsDependent: "auto" },
      { id: "k2", role: "child", relationship: "child", dateOfBirth: "2000-01-01", claimedAsDependent: "auto" }, // 25 — not counted
      { id: "k3", role: "child", relationship: "stepchild", dateOfBirth: "2012-01-01", claimedAsDependent: "no" }, // excluded
    );
    const r = householdRules(inputFixture({ facts: f, plan }));
    const s = r.suggestions.find((x) => x.id === "household.dependents")!;
    expect(s.kind).toBe("review");
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/family`);
    expect(s.returnFigure.display).toBe("2");
    expect(s.planFigure.display).toBe("1");
  });

  it("skips a comparison the return cannot make (null fact)", () => {
    const f = emptyTaxReturnFacts(2025);
    const r = householdRules(inputFixture({ facts: f }));
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([]);
  });
});
