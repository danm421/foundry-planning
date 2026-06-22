import { describe, expect, it } from "vitest";
import { mapPlaidToFoundry, mapPlaidToLiability } from "../account-mapping";

describe("mapPlaidToFoundry", () => {
  it.each([
    ["depository", "checking", "cash", "checking"],
    ["depository", "savings", "cash", "savings"],
    ["depository", "hsa", "cash", "hsa"],
    ["depository", "cd", "cash", "cd"],
    ["depository", "money market", "cash", "money_market"],
    ["depository", "money_market", "cash", "money_market"],
    ["depository", "cash management", "cash", "checking"],
    ["depository", "paypal", "cash", "checking"],
    ["investment", "401k", "retirement", "401k"],
    ["investment", "403b", "retirement", "403b"],
    ["investment", "ira", "retirement", "traditional_ira"],
    ["investment", "roth_ira", "retirement", "roth_ira"],
    ["investment", "roth ira", "retirement", "roth_ira"],
    ["investment", "sep_ira", "retirement", "sep_ira"],
    ["investment", "simple_ira", "retirement", "simple_ira"],
    ["investment", "401a", "retirement", "401a"],
    ["investment", "brokerage", "taxable", "brokerage"],
    ["investment", "529", "taxable", "529"],
    ["investment", "mutual fund", "taxable", "brokerage"], // fallback
    ["depository", "unknown thing", "cash", "other"], // fallback
  ])("maps %s.%s → %s.%s", (type, subtype, category, subType) => {
    expect(mapPlaidToFoundry(type, subtype)).toEqual({ category, subType });
  });

  it.each([
    ["loan", "mortgage"],
    ["loan", "student"],
    ["credit", "credit card"],
    ["credit", "paypal"],
    ["other", "anything"],
  ])("returns null for unsupported type %s.%s", (type, subtype) => {
    expect(mapPlaidToFoundry(type, subtype)).toBeNull();
  });
});

describe("mapPlaidToLiability", () => {
  it("maps credit → credit_card", () => {
    expect(mapPlaidToLiability("credit", "credit card")).toEqual({ liabilityType: "credit_card" });
  });
  it("maps loan subtypes", () => {
    expect(mapPlaidToLiability("loan", "mortgage")).toEqual({ liabilityType: "mortgage" });
    expect(mapPlaidToLiability("loan", "auto")).toEqual({ liabilityType: "auto" });
    expect(mapPlaidToLiability("loan", "student")).toEqual({ liabilityType: "student" });
    expect(mapPlaidToLiability("loan", "home equity")).toEqual({ liabilityType: "heloc" });
    expect(mapPlaidToLiability("loan", "line of credit")).toEqual({ liabilityType: "personal" });
    expect(mapPlaidToLiability("loan", "other")).toEqual({ liabilityType: "other" });
  });
  it("returns null for non-debt Plaid types (so caller uses mapPlaidToFoundry)", () => {
    expect(mapPlaidToLiability("depository", "checking")).toBeNull();
    expect(mapPlaidToLiability("investment", "brokerage")).toBeNull();
  });
});
