import { describe, it, expect } from "vitest";
import { computeStateInheritanceTax } from "../compute";

describe("PA — all life insurance excluded (named bene or estate)", () => {
  it("Class B heir with $200K life-ins + $300K other → tax only on $300K", () => {
    const r = computeStateInheritanceTax({
      state: "PA",
      deathYear: 2026,
      decedentAge: 65,
      grossEstate: 500_000,
      recipients: [{
        key: "r1", label: "Adult Child", grossShare: 500_000,
        components: [
          { kind: "life_insurance", amount: 200_000 },
          { kind: "other", amount: 300_000 },
        ],
        relationship: "child", isMinorChild: false, age: null,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    // 300_000 × 4.5% = 13_500
    expect(r.totalTax).toBe(13_500);
    expect(r.perRecipient[0].excluded).toBe(200_000);
    expect(r.perRecipient[0].excludedReasons).toContain(
      "All life insurance excluded (PA 72 Pa.C.S. §9116(a)).",
    );
  });
});

describe("PA — IRA excluded when decedent under 59½", () => {
  it("Class B heir with $400K IRA inherited from decedent age 58 → IRA excluded", () => {
    const r = computeStateInheritanceTax({
      state: "PA",
      deathYear: 2026,
      decedentAge: 58,
      grossEstate: 400_000,
      recipients: [{
        key: "r1", label: "Adult Child", grossShare: 400_000,
        components: [{ kind: "ira", amount: 400_000 }],
        relationship: "child", isMinorChild: false, age: null,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
    expect(r.perRecipient[0].excluded).toBe(400_000);
    expect(r.perRecipient[0].excludedReasons).toContain(
      "IRA excluded — decedent was under 59½ at death (PA 72 Pa.C.S. §9111(r)).",
    );
  });

  it("IRA NOT excluded when decedent is 60", () => {
    const r = computeStateInheritanceTax({
      state: "PA",
      deathYear: 2026,
      decedentAge: 60,
      grossEstate: 400_000,
      recipients: [{
        key: "r1", label: "Adult Child", grossShare: 400_000,
        components: [{ kind: "ira", amount: 400_000 }],
        relationship: "child", isMinorChild: false, age: null,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    // 400_000 × 4.5% = 18_000
    expect(r.totalTax).toBe(18_000);
    expect(r.perRecipient[0].excluded).toBe(0);
  });
});

describe("NE — under-22 beneficiary exemption (LB310)", () => {
  it("Class B grandchild age 19 → fully exempt", () => {
    const r = computeStateInheritanceTax({
      state: "NE",
      deathYear: 2026,
      decedentAge: 75,
      grossEstate: 500_000,
      recipients: [{
        key: "g1", label: "Grandchild", grossShare: 500_000,
        components: [{ kind: "other", amount: 500_000 }],
        relationship: "grandchild", isMinorChild: false, age: 19,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
    expect(r.perRecipient[0].excluded).toBe(500_000);
    expect(r.perRecipient[0].excludedReasons).toContain(
      "Beneficiary under age 22 — fully exempt (Neb. Rev. Stat. §77-2007.04, LB310).",
    );
  });

  it("Class C niece age 35 at $200K → $17,600", () => {
    // ($200K - $40K exemption) × 11% = $17,600
    const r = computeStateInheritanceTax({
      state: "NE",
      deathYear: 2026,
      decedentAge: 75,
      grossEstate: 200_000,
      recipients: [{
        key: "n1", label: "Niece", grossShare: 200_000,
        components: [{ kind: "other", amount: 200_000 }],
        relationship: "niece_nephew", isMinorChild: false, age: 35,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(17_600);
    expect(r.perRecipient[0].classLabel).toBe("C");
    expect(r.perRecipient[0].exemption).toBe(40_000);
    expect(r.perRecipient[0].taxableShare).toBe(160_000);
  });

  it("NE spouse → exempt (no Class A)", () => {
    const r = computeStateInheritanceTax({
      state: "NE",
      deathYear: 2026,
      decedentAge: 75,
      grossEstate: 1_000_000,
      recipients: [{
        key: "sp", label: "Spouse", grossShare: 1_000_000,
        components: [{ kind: "other", amount: 1_000_000 }],
        relationship: "spouse", isMinorChild: false, age: 70,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
    expect(r.perRecipient[0].classLabel).toBe("exempt");
    expect(r.perRecipient[0].classSource).toBe("spouse-role");
  });

  it("Niece age missing (null) does not exempt under-22 — defaults to taxable", () => {
    const r = computeStateInheritanceTax({
      state: "NE",
      deathYear: 2026,
      decedentAge: 75,
      grossEstate: 200_000,
      recipients: [{
        key: "n2", label: "Niece (DOB unknown)", grossShare: 200_000,
        components: [{ kind: "other", amount: 200_000 }],
        relationship: "niece_nephew", isMinorChild: false, age: null,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(17_600);
    expect(r.perRecipient[0].excludedReasons).not.toContain(
      "Beneficiary under age 22 — fully exempt (Neb. Rev. Stat. §77-2007.04, LB310).",
    );
  });
});
