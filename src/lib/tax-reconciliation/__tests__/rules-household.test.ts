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
    // Whole rows, not just ids: a check that names the wrong label or prints the
    // wrong figure has to fail here. (A household check is emitted only when the
    // two sides are equal, so a returnDisplay/planDisplay swap is not observable
    // on these three — the swap-detecting rows live in the assumptions suite,
    // and on the suggestion figures below, where the two sides differ.)
    expect(r.checks).toEqual([
      { id: "household.filingStatus", label: "Filing status", returnDisplay: "Married filing jointly", planDisplay: "Married filing jointly" },
      { id: "household.residenceState", label: "Residence state", returnDisplay: "PA", planDisplay: "PA" },
      { id: "household.dependents", label: "Dependents", returnDisplay: "0", planDisplay: "0" },
    ]);
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
    // Ordered: the return's status comes first. Swapping the two sides fails this.
    expect(s.headline).toMatch(/filed married filing jointly;.*models single\./);
  });

  it("suggests residence state when the plan has none or a different one", () => {
    const none = householdRules(inputFixture({ facts: facts(), plan: planFixture({ planSettings: { ...planFixture().planSettings, residenceState: null } }) }));
    const missing = none.suggestions.find((s) => s.id === "household.residenceState")!;
    expect(missing.action?.target).toEqual({ kind: "plan_settings.update", patch: { residenceState: "PA" } });
    expect(missing.returnFigure.display).toBe("PA");
    expect(missing.planFigure.display).toBe("Not set");
    expect(missing.delta).toEqual({ amount: null, display: "Not set", tone: "missing" });

    const other = householdRules(inputFixture({ facts: facts(), plan: planFixture({ planSettings: { ...planFixture().planSettings, residenceState: "NJ" } }) }));
    const differing = other.suggestions.find((s) => s.id === "household.residenceState")!;
    expect(differing.returnFigure.display).toBe("PA");
    expect(differing.planFigure.display).toBe("NJ");
    expect(differing.delta).toEqual({ amount: null, display: "Differs", tone: "neutral" });
    // Ordered: the return's state comes first. Swapping PA and NJ fails this.
    expect(differing.headline).toMatch(/filed from PA;.*household in NJ\./);
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
    // A headcount is never rendered as money: makeDelta(2, 1) would say "Plan is $1 short".
    expect(s.delta).toEqual({ amount: -1, display: "Differs", tone: "neutral" });
    expect(s.delta.display).not.toContain("$");
  });

  it("tones the dependents delta as missing when the plan has no children at all", () => {
    const f = facts();
    f.dependentsUnder17 = 2;
    const r = householdRules(inputFixture({ facts: f }));   // the fixture household has no children
    const s = r.suggestions.find((x) => x.id === "household.dependents")!;
    expect(s.delta).toEqual({ amount: -2, display: "Differs", tone: "missing" });
    expect(s.delta.display).not.toContain("$");
  });

  it("skips a comparison the return cannot make (null fact)", () => {
    const f = emptyTaxReturnFacts(2025);
    const r = householdRules(inputFixture({ facts: f }));
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([]);
  });
});
