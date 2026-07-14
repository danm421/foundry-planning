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

  // --- Fact-finder: Tier 1 (vendor signatures) ---

  it("detects an eMoney fact finder by vendor signature", () => {
    expect(
      classifyDocument("eMoney Advisor — Confidential Client Profile\nPrepared for the Smith family")
    ).toBe("fact_finder");
  });

  it("detects a MoneyGuidePro fact finder", () => {
    expect(classifyDocument("MoneyGuidePro Retirement Analysis\nPIETech, Inc.")).toBe("fact_finder");
  });

  it("detects a RightCapital fact finder", () => {
    expect(classifyDocument("RightCapital Financial Plan Summary")).toBe("fact_finder");
  });

  it("detects a NaviPlan fact finder", () => {
    expect(classifyDocument("NaviPlan by Advicent — Client Report")).toBe("fact_finder");
  });

  it("detects a generic 'Fact Finder' title", () => {
    expect(classifyDocument("Confidential Financial Planning Questionnaire")).toBe("fact_finder");
  });

  it("detects a fact finder from the FILENAME when the text is generic", () => {
    expect(
      classifyDocument("General overview prepared for the client.", "Smith-MoneyGuidePro-2025.pdf")
    ).toBe("fact_finder");
  });

  // --- Fact-finder: Tier 2 (structural, unbranded) ---

  it("detects an unbranded fact finder structurally (>=4 planning categories)", () => {
    const text =
      "Client Financial Summary\n" +
      "John's salary is $120,000 and he has pension income.\n" +
      "Monthly living expenses total $6,000.\n" +
      "Mortgage balance is $300,000.\n" +
      "Life insurance death benefit of $500,000.\n" +
      "Spouse Jane, date of birth 1970-01-01.";
    expect(classifyDocument(text)).toBe("fact_finder");
  });

  it("does NOT structurally flag a doc that hits 4 categories with only ONE planning-only category", () => {
    // assets(account/balance) + income(salary) + liabilities(mortgage) + family(spouse, planning-only)
    // = 4 categories but only 1 planning-only → stays a plain account statement under the >=2 rule.
    const text =
      "Account balance $100,000.\nSalary $120,000.\nMortgage balance $300,000.\nSpouse Jane.";
    expect(classifyDocument(text)).toBe("account_statement");
  });

  // --- False-positive guards ---

  it("does NOT treat a plain brokerage statement as a fact finder", () => {
    const text =
      "Account Statement\nSchwab Brokerage\nMarket Value: $150,000\n" +
      "Holdings: VTI, VXUS\nDividend paid this period.";
    expect(classifyDocument(text)).toBe("account_statement");
  });

  it("keeps a Form 1040 as a tax return, not a fact finder", () => {
    const text =
      "Form 1040\nAdjusted Gross Income\nTaxable Income\nWages, salaries, tips\n" +
      "Mortgage interest deduction\nSpouse filing jointly";
    expect(classifyDocument(text)).toBe("tax_return");
  });

  it("keeps a pay stub as a pay stub", () => {
    expect(
      classifyDocument("EARNINGS STATEMENT\nGross Pay: $5,000\nNet Pay: $3,500\nYTD\nFederal Withholding")
    ).toBe("pay_stub");
  });

  it("does not match a stray 'advisor' mention as a fact finder", () => {
    expect(classifyDocument("Please contact your financial advisor about your account.")).toBe(
      "account_statement"
    );
  });
});
