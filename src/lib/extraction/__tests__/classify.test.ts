import { describe, it, expect } from "vitest";
import { classifyDocument, matchesKeyword } from "../classify";

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

/**
 * A real ADP earnings statement (Jennifer Sharesky, pay date 2026-08-21) was
 * classified `account_statement` in production, routed to the account-statement
 * prompt, and produced a $12,545 "Checking" account out of the year-to-date
 * federal income tax column. The pay-stub prompt returns only `incomes` and
 * `savings` — it has no `accounts` key — so classification is the only thing
 * standing between a payroll document and an invented account balance.
 *
 * Every one of the four `account_statement` keyword hits on that document was a
 * false positive, which is why it outscored `pay_stub` 4–3:
 *   "statement" ← "Earnings Statement"      (the phrase that proves it is a stub)
 *   "balance"   ← "Pto Balance"             (paid-time-off HOURS)
 *   "account"   ← "Deposited to the account of …" (the direct-deposit stub)
 *   "shares"    ← "JENNIFER SHARESKY"       (the client's SURNAME)
 */
const REAL_ADP_EARNINGS_STATEMENT = [
  "          CO.     FILE      DEPT.      CLOCK    VCHR. NO.",
  "          VLT    021944     009091    09PH      0000344172   1",
  "          M ARTHUR GENSLER  JR & ASSOCIATES  INC      Earnings Statement",
  "          220 MONTGOMERY STREET SUITE 200             Period Beginning:  08/02/2026",
  "          SAN FRANCISCO, CA 94104                     Period Ending:     08/15/2026",
  "                                                      Pay Date:          08/21/2026",
  "          Taxable Marital Status:   Married               JENNIFER SHARESKY",
  "          Exemptions/Allowances:                          104 PANCOAST AVENUE",
  "                                                          MOORESTOWN NJ 08057",
  "                 rate    hours   this period   year to date",
  "Regular    75 2403      60 00      4 514 42       67 530 26   Net Pay        $3 217 20",
  "Paid Time Off 75 2400    4 00        300 96        8 383 91   Checking 1    -3 217 20",
  "         Gross Pay                 $4 841 23      110 413 63  Net Check          $0 00",
  "         Federal Income Tax          -384 00       12 455 06",
  "         Social Security Tax         -285 69        6 599 44",
  "         Medicare Tax                 -66 82        1 543 42",
  "                                                              Pto Balance        6 40",
  "         Deposited       to the account of      account number   transit  ABA",
].join("\n");

describe("classifyDocument — a payroll document is never an account statement", () => {
  it("classifies the real ADP earnings statement as a pay stub", () => {
    expect(
      classifyDocument(REAL_ADP_EARNINGS_STATEMENT, "Jenn Sharesky_Pay Date 2026-08-21.pdf"),
    ).toBe("pay_stub");
  });

  it("does not credit 'shares' to a surname that merely contains it", () => {
    expect(matchesKeyword("jennifer sharesky", "shares")).toBe(false);
    expect(matchesKeyword("120.5000 shares of vti", "shares")).toBe(true);
  });

  it("still matches keywords that end in a non-word character", () => {
    // A trailing \b would demand a word character after the ")" and never fire.
    expect(matchesKeyword("balance in the 401(k) plan", "401(k)")).toBe(true);
    expect(matchesKeyword("w-2 wages, tips", "w-2")).toBe(true);
    expect(matchesKeyword("form 1040 line 11", "form 1040")).toBe(true);
  });

  it("matches a keyword that ends in punctuation against its plural", () => {
    // The boundary is applied per EDGE, not unconditionally: ")" already is a
    // boundary, so demanding a non-alphanumeric after it would lose "401(k)s".
    expect(matchesKeyword("rolled over his 401(k)s last year", "401(k)")).toBe(true);
  });

  it("keeps a titleless payroll document off the account-statement prompt", () => {
    // The production document with its "Earnings Statement" title removed, so the
    // payroll tier cannot fire and the keyword rules alone have to get it right.
    // "SHARESKY" was the deciding vote for account_statement here.
    const text =
      "JENNIFER SHARESKY\nStatement of account activity\nGross Pay\nNet Pay\nYTD\n" +
      "Pto Balance 6 40\nDeposited to the account of";
    expect(classifyDocument(text)).toBe("pay_stub");
  });

  it("does not let 'Earnings Statement' count toward an account statement", () => {
    expect(classifyDocument("Earnings Statement\nPto Balance\nGross Pay\nNet Pay")).toBe("pay_stub");
  });

  it("keeps a stub that carries its own 401(k) fund table as a pay stub", () => {
    // Word boundaries are not enough here: the retirement-deduction detail block
    // that many stubs print scores the account-statement rule 6-3. Only the
    // payroll title + corroboration tier gets this right.
    const text =
      "Earnings Statement\nPay Date: 08/21/2026\nGross Pay $4,841.23\nNet Pay $3,217.20\n" +
      "Your 401(k) Account\nPortfolio Balance\nShares 120.5\nMarket Value $67,530.26";
    expect(classifyDocument(text)).toBe("pay_stub");
  });

  // --- Non-vacuity: the fix must not drag real statements out of their type ---

  it("still classifies a real brokerage statement for the same family", () => {
    const text =
      "Charles Schwab\nAccount Statement for MICHAEL V SHARESKY\n" +
      "Account Number ...0990\nMarket Value $8,618.60\nPositions Held\nShares 120.5";
    expect(classifyDocument(text, "Mike Sharesky Schwab Taxable 0707 Statement.PDF")).toBe(
      "account_statement",
    );
  });

  it("still classifies a 401(k) participant statement as an account statement", () => {
    const text =
      "Voya Financial\nYour Account Balance as of June 30, 2026\n" +
      "Plan Number 551847\nYour Current Investment Portfolio\nMarket Value\nShares";
    expect(classifyDocument(text, "Mike Sharesky 401k Q2 2026.pdf")).toBe("account_statement");
  });

  it("does not fire on a passing mention of a pay stub with no payroll figures", () => {
    // The corroboration requirement, not the vendor tier, is what refuses this:
    // the text carries a payroll TITLE phrase and no vendor branding at all.
    expect(
      classifyDocument("Please attach your most recent pay stub before our meeting."),
    ).not.toBe("pay_stub");
  });

  it("does not hijack a fact finder that merely asks for a pay stub", () => {
    const text =
      "eMoney Advisor — Confidential Client Profile\n" +
      "Please attach your most recent pay stub, along with monthly expenses,\n" +
      "life insurance policy, retirement goal and date of birth for each spouse.";
    expect(classifyDocument(text)).toBe("fact_finder");
  });
});
