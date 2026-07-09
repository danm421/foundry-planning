import { describe, it, expect } from "vitest";
import { categoryLabel, debtTypeLabel, orderedCategories, subTypeLabel } from "./labels";

describe("categoryLabel", () => {
  it("maps known category keys", () => {
    expect(categoryLabel("cash")).toBe("Cash");
    expect(categoryLabel("real_estate")).toBe("Real estate");
    expect(categoryLabel("stock_options")).toBe("Stock options");
  });
  it("title-cases an unknown key (underscores to spaces)", () => {
    expect(categoryLabel("crypto_wallet")).toBe("Crypto wallet");
  });
});

describe("subTypeLabel", () => {
  it("replaces underscores with spaces, staying lowercase (mirrors web)", () => {
    expect(subTypeLabel("traditional_ira")).toBe("traditional ira");
    expect(subTypeLabel("checking")).toBe("checking");
  });
});

describe("debtTypeLabel", () => {
  it("maps known liability types", () => {
    expect(debtTypeLabel("mortgage")).toBe("Mortgage");
    expect(debtTypeLabel("heloc")).toBe("HELOC");
    expect(debtTypeLabel("credit_card")).toBe("Credit card");
    expect(debtTypeLabel("other")).toBe("Loan");
  });
  it("returns 'Debt' when the type is null", () => {
    expect(debtTypeLabel(null)).toBe("Debt");
  });
  it("title-cases an unknown type", () => {
    expect(debtTypeLabel("margin_loan")).toBe("Margin loan");
  });
});

describe("orderedCategories", () => {
  it("returns known categories in CATEGORY_ORDER, ignoring input order", () => {
    expect(orderedCategories(["retirement", "cash", "taxable"])).toEqual([
      "cash",
      "taxable",
      "retirement",
    ]);
  });
  it("dedups repeated categories", () => {
    expect(orderedCategories(["cash", "cash", "taxable"])).toEqual(["cash", "taxable"]);
  });
  it("appends unknown categories alphabetically after the known ones", () => {
    expect(orderedCategories(["business", "cash", "annuity"])).toEqual([
      "cash",
      "annuity",
      "business",
    ]);
  });
  it("dedups unknown categories too", () => {
    expect(orderedCategories(["business", "business", "annuity"])).toEqual([
      "annuity",
      "business",
    ]);
  });
  it("returns an empty array for no categories", () => {
    expect(orderedCategories([])).toEqual([]);
  });
});
