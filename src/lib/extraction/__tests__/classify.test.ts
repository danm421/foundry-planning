import { describe, it, expect } from "vitest";
import { classifyDocument } from "../classify";

describe("classifyDocument", () => {
  it("detects account statement", () => {
    expect(classifyDocument("Account Statement\nBalance: $50,000\nHoldings")).toBe(
      "account_statement"
    );
  });

  it("detects pay stub", () => {
    expect(classifyDocument("EARNINGS STATEMENT\nGross Pay: $5,000\nNet Pay: $3,500\nYTD")).toBe(
      "pay_stub"
    );
  });

  it("detects insurance", () => {
    expect(classifyDocument("Policy Declarations\nPremium: $200/mo\nCoverage: $500,000")).toBe(
      "insurance"
    );
  });

  it("detects expense worksheet", () => {
    expect(classifyDocument("Monthly Expenses\nRent: $2,000\nGroceries: $500\nAnnual Spending")).toBe(
      "expense_worksheet"
    );
  });

  it("detects tax return", () => {
    expect(classifyDocument("Form 1040\nAdjusted Gross Income\nTaxable Income")).toBe(
      "tax_return"
    );
  });

  it("defaults to account_statement for unrecognized text", () => {
    expect(classifyDocument("some random financial document")).toBe("account_statement");
  });
});
