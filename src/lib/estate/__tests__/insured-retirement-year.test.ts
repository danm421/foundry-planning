import { describe, it, expect } from "vitest";
import { insuredRetirementYearFor } from "../insurance-in-force";
import type { Account } from "@/engine/types";

const baseAccount = {
  id: "pol1",
  name: "Term Pol",
  category: "life_insurance",
  subType: "term",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [],
} as unknown as Account;

describe("insuredRetirementYearFor", () => {
  it("returns null when account.insuredPerson is unset", () => {
    const a = { ...baseAccount, insuredPerson: null } as Account;
    expect(insuredRetirementYearFor(a, 2035, 2039)).toBe(null);
  });

  it("returns null when account.insuredPerson is not one of client/spouse/joint", () => {
    const a = { ...baseAccount, insuredPerson: undefined } as Account;
    expect(insuredRetirementYearFor(a, 2035, 2039)).toBe(null);
  });

  it("resolves the client's retirement year", () => {
    const a = { ...baseAccount, insuredPerson: "client" } as Account;
    expect(insuredRetirementYearFor(a, 2035, 2039)).toBe(2035);
  });

  it("resolves the spouse's retirement year", () => {
    const a = { ...baseAccount, insuredPerson: "spouse" } as Account;
    expect(insuredRetirementYearFor(a, 2035, 2039)).toBe(2039);
  });

  it("returns the later of the two retirement years for joint", () => {
    const a = { ...baseAccount, insuredPerson: "joint" } as Account;
    expect(insuredRetirementYearFor(a, 2035, 2039)).toBe(2039);
    expect(insuredRetirementYearFor(a, 2042, 2039)).toBe(2042);
  });

  it("returns null for joint when both retirement years are null", () => {
    const a = { ...baseAccount, insuredPerson: "joint" } as Account;
    expect(insuredRetirementYearFor(a, null, null)).toBe(null);
  });

  it("falls back to the non-null side for joint when one is null", () => {
    const a = { ...baseAccount, insuredPerson: "joint" } as Account;
    expect(insuredRetirementYearFor(a, 2035, null)).toBe(2035);
    expect(insuredRetirementYearFor(a, null, 2039)).toBe(2039);
  });

  it("returns null for client when clientRetirementYear is null", () => {
    const a = { ...baseAccount, insuredPerson: "client" } as Account;
    expect(insuredRetirementYearFor(a, null, 2039)).toBe(null);
  });
});
