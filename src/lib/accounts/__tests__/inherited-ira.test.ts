import { describe, it, expect } from "vitest";
import {
  canBeInheritedIra,
  validateInheritedIraFields,
  inheritedIraBodyFields,
  inheritedIraFormError,
  inheritedIraRowFields,
} from "../inherited-ira";

const V = (over: Partial<Parameters<typeof validateInheritedIraFields>[0]>) =>
  validateInheritedIraFields({
    category: "retirement", subType: "traditional_ira",
    inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, currentYear: 2026, ...over,
  });

describe("canBeInheritedIra", () => {
  it("allows only Traditional and Roth IRAs", () => {
    expect(canBeInheritedIra("retirement", "traditional_ira")).toBe(true);
    expect(canBeInheritedIra("retirement", "roth_ira")).toBe(true);
    expect(canBeInheritedIra("retirement", "401k")).toBe(false);
    expect(canBeInheritedIra("taxable", "traditional_ira")).toBe(false);
  });
});

describe("validateInheritedIraFields", () => {
  it("accepts a valid pair and an absent pair", () => {
    expect(V({})).toBeNull();
    expect(V({ inheritedDeathYear: null, inheritedOwnerBirthYear: null })).toBeNull();
    expect(V({ subType: "401k", inheritedDeathYear: null, inheritedOwnerBirthYear: undefined })).toBeNull();
  });
  it("rejects half a pair", () => {
    expect(V({ inheritedOwnerBirthYear: null })).toMatch(/both the year of death/);
  });
  it("rejects a non-IRA", () => {
    expect(V({ subType: "401k" })).toMatch(/Traditional or Roth IRA/);
  });
  it("rejects impossible years", () => {
    expect(V({ inheritedDeathYear: 2022.5 })).toMatch(/whole numbers/);
    expect(V({ inheritedOwnerBirthYear: 1899 })).toMatch(/1900 or later/);
    expect(V({ inheritedDeathYear: 1945 })).toMatch(/after the original owner's birth year/);
    expect(V({ inheritedOwnerBirthYear: 1900, inheritedDeathYear: 2021 })).toMatch(/older than 120/);
    expect(V({ inheritedDeathYear: 2027 })).toMatch(/later than 2026/);
  });
});

describe("inheritedIraBodyFields", () => {
  const ticked = { inherited: true, deathYear: "2022", ownerBirthYear: "1945", heirDisabled: true };
  it("sends numbers when ticked on an IRA", () => {
    expect(inheritedIraBodyFields(ticked, "retirement", "roth_ira")).toEqual({
      inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true,
    });
  });
  it("clears everything when unticked", () => {
    expect(inheritedIraBodyFields({ ...ticked, inherited: false }, "retirement", "traditional_ira")).toEqual({
      inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false,
    });
  });
  it("clears everything when the account type can't be inherited (type switched to 401(k))", () => {
    expect(inheritedIraBodyFields(ticked, "retirement", "401k")).toEqual({
      inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false,
    });
  });
});

describe("inheritedIraFormError", () => {
  const blank = { inherited: true, deathYear: "", ownerBirthYear: "", heirDisabled: false };
  it("asks for both years when ticked and blank", () => {
    expect(inheritedIraFormError(blank, "retirement", "traditional_ira", 2026)).toMatch(/Enter the year of death/);
  });
  it("is silent when unticked or not an IRA", () => {
    expect(inheritedIraFormError({ ...blank, inherited: false }, "retirement", "traditional_ira", 2026)).toBeNull();
    expect(inheritedIraFormError(blank, "retirement", "401k", 2026)).toBeNull();
  });
  it("passes through the server rules", () => {
    expect(inheritedIraFormError({ ...blank, deathYear: "2030", ownerBirthYear: "1945" }, "retirement", "traditional_ira", 2026)).toMatch(/later than 2026/);
  });
});

describe("inheritedIraRowFields", () => {
  it("normalizes undefined to null/false", () => {
    expect(inheritedIraRowFields({})).toEqual({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false });
    expect(inheritedIraRowFields({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true }))
      .toEqual({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true });
  });
});
