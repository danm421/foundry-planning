import { describe, expect, it } from "vitest";
import { mapPlaidToFoundry, mapPlaidToLiability } from "@/plaid/account-mapping";

describe("mapPlaidToFoundry", () => {
  it("depository/checking → cash/checking", () => {
    expect(mapPlaidToFoundry("depository", "checking")).toEqual({ category: "cash", subType: "checking" });
  });
  it("investment/roth ira (spaces) → retirement/roth_ira", () => {
    expect(mapPlaidToFoundry("investment", "roth ira")).toEqual({ category: "retirement", subType: "roth_ira" });
  });
  it("investment unknown → taxable/brokerage", () => {
    expect(mapPlaidToFoundry("investment", "zzz")).toEqual({ category: "taxable", subType: "brokerage" });
  });
  it("loan/credit types → null (not an asset)", () => {
    expect(mapPlaidToFoundry("loan", "auto")).toBeNull();
  });
});
describe("mapPlaidToLiability", () => {
  it("credit → credit_card", () => {
    expect(mapPlaidToLiability("credit", "credit card")).toEqual({ liabilityType: "credit_card" });
  });
  it("loan/home_equity → heloc", () => {
    expect(mapPlaidToLiability("loan", "home_equity")).toEqual({ liabilityType: "heloc" });
  });
  it("depository → null (not a debt)", () => {
    expect(mapPlaidToLiability("depository", "checking")).toBeNull();
  });
});
