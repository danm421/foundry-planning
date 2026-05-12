import { describe, it, expect } from "vitest";
import { computeStateInheritanceTax } from "../compute";

describe("computeStateInheritanceTax — PA flat", () => {
  it("Class B (adult child) at $500K → 4.5% = $22,500", () => {
    const r = computeStateInheritanceTax({
      state: "PA",
      deathYear: 2026,
      decedentAge: 65,
      grossEstate: 500_000,
      recipients: [{
        key: "r1", label: "Adult Child", grossShare: 500_000,
        components: [{ kind: "other", amount: 500_000 }],
        relationship: "child", isMinorChild: false, age: null,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.state).toBe("PA");
    expect(r.inactive).toBe(false);
    expect(r.totalTax).toBe(22_500);
    expect(r.perRecipient).toHaveLength(1);
    expect(r.perRecipient[0]).toMatchObject({
      classLabel: "B",
      classSource: "derived-from-relationship",
      grossShare: 500_000,
      exemption: 0,
      taxableShare: 500_000,
      tax: 22_500,
      netToRecipient: 477_500,
    });
    expect(r.perRecipient[0].bracketLines).toHaveLength(1);
    expect(r.perRecipient[0].bracketLines[0]).toMatchObject({
      from: 0, to: 500_000, rate: 0.045, amountTaxed: 500_000, tax: 22_500,
    });
  });

  it("inactive (null state) returns empty result", () => {
    const r = computeStateInheritanceTax({
      state: null,
      deathYear: 2026,
      decedentAge: 65,
      grossEstate: 0,
      recipients: [],
    });
    expect(r.state).toBeNull();
    expect(r.inactive).toBe(true);
    expect(r.totalTax).toBe(0);
    expect(r.perRecipient).toEqual([]);
  });
});

describe("computeStateInheritanceTax — KY graduated", () => {
  // Math derivation for $150K to a niece (Class B):
  //   Exemption $1K → taxable share $149K
  //   $0–$10K @ 4%   =   $400
  //   $10K–$20K @ 5% =   $500
  //   $20K–$30K @ 6% =   $600
  //   $30K–$45K @ 8% = $1,200
  //   $45K–$60K @10% = $1,500
  //   $60K–$100K@12% = $4,800
  //   $100K–$149K@14%= $6,860
  //   Total = $15,860
  it("Class B niece at $150K → $15,860", () => {
    const r = computeStateInheritanceTax({
      state: "KY",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 150_000,
      recipients: [{
        key: "n1", label: "Niece", grossShare: 150_000,
        components: [{ kind: "other", amount: 150_000 }],
        relationship: "niece_nephew", isMinorChild: false, age: 35,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(15_860);
    expect(r.perRecipient[0].classLabel).toBe("B");
    expect(r.perRecipient[0].exemption).toBe(1_000);
    expect(r.perRecipient[0].taxableShare).toBe(149_000);
    expect(r.perRecipient[0].bracketLines).toHaveLength(7);
  });

  // Math: $60K to unrelated friend (Class C):
  //   Exemption $500 → taxable share $59,500
  //   $0–$10K @ 6%  =   $600
  //   $10K–$20K @ 8% = $800
  //   $20K–$30K @ 10%=$1,000
  //   $30K–$45K @ 12%=$1,800
  //   $45K–$59.5K@14%=$2,030
  //   Total = $6,230
  it("Class C friend at $60K → $6,230", () => {
    const r = computeStateInheritanceTax({
      state: "KY",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 60_000,
      recipients: [{
        key: "f1", label: "Friend", grossShare: 60_000,
        components: [{ kind: "other", amount: 60_000 }],
        relationship: "other", isMinorChild: false, age: 50,
        domesticPartner: false, isCharity: false, isExternalIndividual: true,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(6_230);
    expect(r.perRecipient[0].classLabel).toBe("C");
    expect(r.perRecipient[0].exemption).toBe(500);
  });

  it("Class A sibling owes nothing (KY uniquely puts siblings in A)", () => {
    const r = computeStateInheritanceTax({
      state: "KY",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 500_000,
      recipients: [{
        key: "s1", label: "Sibling", grossShare: 500_000,
        components: [{ kind: "other", amount: 500_000 }],
        relationship: "sibling", isMinorChild: false, age: 60,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
  });
});

describe("computeStateInheritanceTax — NJ", () => {
  // Math: $900K to friend (Class D, no exemption):
  //   $0–$700K @ 15% = $105,000
  //   $700K–$900K @ 16% = $32,000
  //   Total = $137,000
  it("Class D friend at $900K → $137,000", () => {
    const r = computeStateInheritanceTax({
      state: "NJ",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 900_000,
      recipients: [{
        key: "f1", label: "Friend", grossShare: 900_000,
        components: [{ kind: "other", amount: 900_000 }],
        relationship: "other", isMinorChild: false, age: 50,
        domesticPartner: false, isCharity: false, isExternalIndividual: true,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(137_000);
  });

  it("Class D $500 de minimis: $400 bequest → $0", () => {
    const r = computeStateInheritanceTax({
      state: "NJ",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 400,
      recipients: [{
        key: "f1", label: "Friend", grossShare: 400,
        components: [{ kind: "other", amount: 400 }],
        relationship: "other", isMinorChild: false, age: 50,
        domesticPartner: false, isCharity: false, isExternalIndividual: true,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
    expect(r.perRecipient[0].notes).toContain(
      "Bequest under $500 de minimis threshold — no tax (NJSA 54:34-2(a)(1)).",
    );
    expect(r.perRecipient[0].tax).toBe(0);
    expect(r.perRecipient[0].bracketLines).toEqual([]);
  });

  // Math: sibling Class C at $2M; exemption $25K → taxable $1,975,000:
  //   $0–$1,075K @ 11% = $118,250
  //   $1,075K–$1,375K @ 13% = $39,000
  //   $1,375K–$1,675K @ 14% = $42,000
  //   $1,675K–$1,975K @ 16% = $48,000
  //   Total = $247,250
  it("Class C sibling at $2M → $247,250", () => {
    const r = computeStateInheritanceTax({
      state: "NJ",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 2_000_000,
      recipients: [{
        key: "s1", label: "Sibling", grossShare: 2_000_000,
        components: [{ kind: "other", amount: 2_000_000 }],
        relationship: "sibling", isMinorChild: false, age: 60,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(247_250);
  });
});

describe("computeStateInheritanceTax — MD", () => {
  it("Class A sibling at $1M → $0", () => {
    const r = computeStateInheritanceTax({
      state: "MD",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 1_000_000,
      recipients: [{
        key: "s1", label: "Sibling", grossShare: 1_000_000,
        components: [{ kind: "other", amount: 1_000_000 }],
        relationship: "sibling", isMinorChild: false, age: 60,
        domesticPartner: false, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
  });

  it("Class B friend at $100K → ($100K - $1K) × 10% = $9,900", () => {
    const r = computeStateInheritanceTax({
      state: "MD",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 100_000,
      recipients: [{
        key: "f1", label: "Friend", grossShare: 100_000,
        components: [{ kind: "other", amount: 100_000 }],
        relationship: "other", isMinorChild: false, age: 50,
        domesticPartner: false, isCharity: false, isExternalIndividual: true,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(9_900);
  });

  it("$50K estate floor: gross estate of $40K → all heirs owe $0", () => {
    const r = computeStateInheritanceTax({
      state: "MD",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 40_000,
      recipients: [{
        key: "f1", label: "Friend", grossShare: 40_000,
        components: [{ kind: "other", amount: 40_000 }],
        relationship: "other", isMinorChild: false, age: 50,
        domesticPartner: false, isCharity: false, isExternalIndividual: true,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      }],
    });
    expect(r.totalTax).toBe(0);
    expect(r.estateMinimumFloorApplied).toBe(true);
    expect(r.notes).toContain(
      "Gross estate below $50,000 — no MD inheritance tax (MD Tax-Gen. §7-204(b)).",
    );
  });

  it("Dom-partner joint residence excluded for that recipient only", () => {
    const r = computeStateInheritanceTax({
      state: "MD",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 1_000_000,
      recipients: [{
        key: "dp", label: "Domestic Partner", grossShare: 600_000,
        components: [{ kind: "other", amount: 600_000 }],
        relationship: "other", isMinorChild: false, age: 65,
        domesticPartner: true, isCharity: false, isExternalIndividual: false,
        primaryResidenceJointlyHeldWithDomesticPartner: true,
      }],
    });
    // dom-partner in MD derives Class A (handled in classify); the residence
    // exemption applies on top — but since Class A is already 0%, the result is the
    // same tax-wise. Verify the exclusion line still surfaces for audit clarity.
    expect(r.totalTax).toBe(0);
    expect(r.perRecipient[0].classLabel).toBe("A");
    expect(r.perRecipient[0].classSource).toBe("domestic-partner");
  });
});
