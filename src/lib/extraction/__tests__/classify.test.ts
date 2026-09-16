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

/**
 * The structural fact-finder heuristic fired on 11 of Dan's 24 real client PDFs,
 * none of which is a fact finder, because several of its "planning category"
 * keywords are ordinary financial-document words rather than planning-form
 * labels. The measured hit counts live beside the array they justify — see the
 * table on `PLANNING_CATEGORY_KEYWORDS` in classify.ts.
 *
 * The fixtures below are VERBATIM text from those PDFs, so each one is an
 * end-to-end regression on real production input. Because real text trips
 * several loose keywords at once, these do not pin any keyword individually;
 * the table further down does that.
 */
describe("classifyDocument — planning-category keywords are form labels, not stray words", () => {
  it("does not count the English modal 'will' as an estate document", () => {
    // Verbatim from the Wells Fargo checking statement (line 33).
    const text =
      "Wells Fargo Everyday Checking\nAccount number: 1234567890\n" +
      "Beginning balance $4,201.14\n" +
      "Accounts linked in Summary will be provided a separate statement.\n" +
      "investment account balances (investments available through our brokerage affiliate)\n" +
      "Last four digits of your social security number, Date of Birth.";
    expect(classifyDocument(text, "Wells Fargo Checking Statement 08-31-2026.pdf")).toBe(
      "account_statement",
    );
  });

  it("still detects an estate section written the way a fact finder writes it", () => {
    const text =
      "Client Profile\nAccount balances $250,000.\nSalary $120,000.\n" +
      "Monthly living expenses $6,000.\n" +
      "Last Will and Testament executed 2019; revocable trust in place.";
    expect(classifyDocument(text)).toBe("fact_finder");
  });

  it("does not count 'Investment Objective' boilerplate as a planning goal", () => {
    // Verbatim from the Schwab Roth IRA statement.
    const text =
      "Charles Schwab\nAccount Statement\nMarket Value $184,220.11\nHoldings\n" +
      "Investment Objective:\n" +
      'Estimated Annual Income ("EAI") and Estimated Yield ("EY") calculations\n' +
      "Additional information will be provided upon written request.";
    expect(classifyDocument(text, "Mike Sharesky Schwab Roth IRA Statement.PDF")).toBe(
      "account_statement",
    );
  });

  it("does not count a Privacy/Trading Policy or a carrier's name as insurance", () => {
    // Verbatim fragments from the Voya 401(k) and the mortgage servicer statement.
    const text =
      "Your Account Balance\nYour Current Investment Portfolio\nMarket Value\n" +
      "Excessive Trading Policy - Voya has an Excessive Trading Policy and monitors transfers.\n" +
      'Issued by ReliaStar Life Insurance Company ("ReliaStar"), Minneapolis, MN.\n' +
      "Your beneficiary information will be kept current. Spouse consent required.";
    expect(classifyDocument(text, "Mike Sharesky 401k Q2 2026.pdf")).toBe("account_statement");
  });

  it("does not count mortgage LICENSING boilerplate as a liability", () => {
    // The real servicer statement names the debt "Unpaid Principal Balance" — the
    // word "mortgage" appears only in the licence block and a marketing line.
    const text =
      "Mortgage Account Statement\nUnpaid Principal Balance $412,908.33\nEscrow Balance\n" +
      "Licensed Mortgage Banker-NYS Department of Financial Services.\n" +
      "Massachusetts Mortgage Lender License # MC35953.\n" +
      "Lower your monthly expenses: your payment will be applied to a suspense account.";
    expect(classifyDocument(text, "Mortgage Primary Residence Statement 08-2026.pdf")).toBe(
      "account_statement",
    );
  });

  it("still detects the liability and insurance sections a fact finder writes", () => {
    const text =
      "Confidential Client Summary\nSalary $120,000.\n" +
      "Mortgage balance $300,000 and a credit card balance.\n" +
      "Life insurance coverage with a death benefit of $500,000.\n" +
      "Retirement goal: retire at age 62.";
    expect(classifyDocument(text)).toBe("fact_finder");
  });

  it("does not count a Social Security NUMBER as retirement income", () => {
    // Income is not planning-only, so it only decides when it is the FOURTH
    // category: assets + expenses + insurance + income = 4 with 2 planning-only.
    // Drop the bogus income hit and the same text is an ordinary statement.
    const text =
      "Account balance $50,000.\n" +
      "Monthly living expenses of $6,000 were paid from this account.\n" +
      "Life insurance coverage of $500,000 through the employer plan.\n" +
      "Last four digits of your social security number.";
    expect(classifyDocument(text)).toBe("account_statement");
  });
});

/**
 * Per-keyword pins.
 *
 * The regression tests above use real text from the production PDFs, so each of
 * them trips SEVERAL of the loose keywords at once — which means restoring any
 * single one leaves the document below the threshold and the test still green.
 * Measured: five of six single-keyword reversions survived that suite.
 *
 * These cases pin one keyword each. The base carries three categories — assets,
 * expenses and family, two of them planning-only — so it sits one category below
 * STRUCTURAL_MIN_CATEGORIES. Appending a single line then decides the outcome,
 * and restoring the keyword that line was chosen for turns the case red.
 */
const STRUCTURAL_BASE =
  "Account balance $50,000.\n" +
  "Living expenses of $6,000 were paid from this account.\n" +
  "Spouse Jane Doe is the joint owner.\n";

/** Lines lifted from the real statements, each tripping exactly one loose keyword. */
const LOOSE_KEYWORD_CASES: { keyword: string; line: string }[] = [
  { keyword: "will", line: "Your payment will be applied to a suspense account." },
  { keyword: "beneficiary", line: "Keep your beneficiary information current." },
  { keyword: "objective", line: "Investment Objective: Growth." },
  { keyword: "policy", line: "Voya has an Excessive Trading Policy and monitors fund transfers." },
  { keyword: "premium", line: "Held in the Premium Money Market Portfolio." },
  { keyword: "life insurance", line: 'Issued by ReliaStar Life Insurance Company ("ReliaStar"), Minneapolis, MN.' },
  { keyword: "mortgage", line: "Licensed Mortgage Banker-NYS Department of Financial Services." },
  { keyword: "social security", line: "Last four digits of your social security number." },
];

/** The phrasing a planning form uses — each replacement must still fire. */
const FORM_LABEL_CASES: { label: string; line: string }[] = [
  { label: "last will", line: "Last will drafted in 2019, held by the attorney." },
  { label: "living will", line: "A living will is on file with the attorney." },
  { label: "will and testament", line: "Their will and testament was updated in 2019." },
  { label: "revocable trust", line: "Assets retitled into the revocable trust." },
  { label: "financial objective", line: "Primary financial objective: fund college." },
  { label: "planning objective", line: "Planning objective: preserve the estate." },
  { label: "retirement goal", line: "The client's retirement goal is documented." },
  { label: "retire at age", line: "They intend to retire at age 62." },
  { label: "life insurance policy", line: "Life insurance policy on Jane for $500,000." },
  { label: "life insurance coverage", line: "Life insurance coverage totals $500,000." },
  { label: "death benefit", line: "Death benefit of $500,000." },
  { label: "annual premium", line: "Annual premium of $1,200." },
  { label: "mortgage balance", line: "Mortgage balance $300,000." },
  { label: "mortgage payment", line: "Mortgage payment $2,100 per month." },
  { label: "social security benefit", line: "Estimated social security benefit $2,400 per month." },
  { label: "social security income", line: "Social security income of $2,400 per month." },
];

describe("classifyDocument — each loose planning keyword is pinned on its own", () => {
  it("the base alone is one category short of the structural threshold", () => {
    // Non-vacuity: if the base already classified as a fact finder, every case
    // below would pass no matter what the appended line did.
    expect(classifyDocument(STRUCTURAL_BASE)).toBe("account_statement");
  });

  it.each(LOOSE_KEYWORD_CASES)(
    "'$keyword' in statement boilerplate does not tip the base into a fact finder",
    ({ line }) => {
      expect(classifyDocument(STRUCTURAL_BASE + line)).toBe("account_statement");
    },
  );

  it.each(FORM_LABEL_CASES)("'$label' still tips the base into a fact finder", ({ line }) => {
    expect(classifyDocument(STRUCTURAL_BASE + line)).toBe("fact_finder");
  });

  it.each(FORM_LABEL_CASES)("'$label' is the only label its line matches", ({ label, line }) => {
    // Guards the guard. Two of these lines originally tripped a second label
    // ("Last Will and Testament" matched both "last will" and "will and
    // testament"), so deleting the label under test left the case green —
    // reproducing, inside the table built to prevent it, the very overlap that
    // made the verbatim-PDF tests above unable to pin a single keyword.
    const also = FORM_LABEL_CASES.filter((c) => matchesKeyword(line.toLowerCase(), c.label));
    expect(also.map((c) => c.label)).toEqual([label]);
  });
});

/**
 * Recall guards.
 *
 * Tightening the planning keywords trades recall for precision, so the trade
 * needs a floor. These are unbranded fact finders carrying NO vendor signature
 * and none of the generic "fact finder" / "financial planning questionnaire" /
 * "client data summary" strings — exactly the documents tier 1 cannot catch and
 * the structural tier exists for.
 *
 * Measured when the keywords were tightened: 3 of 5 realistic shapes that the
 * loose list caught are now missed, all of them for the same reason — a FORM
 * prints the column header, not the sentence ("Mortgage  412,000", "Will [ ]").
 * The two shapes that still work are pinned here so a later tightening cannot
 * quietly take them as well. The missed shapes are recorded in the KNOWN GAP
 * note on PLANNING_CATEGORY_KEYWORDS; closing it means matching a bare word
 * only when it labels a value, which needs its own corpus sweep.
 */
describe("classifyDocument — unbranded fact finders are still detected", () => {
  it("detects a prose narrative fact finder", () => {
    const text =
      "Client Financial Summary\nJohn's salary is $120,000 with pension income.\n" +
      "Monthly living expenses total $6,000.\nMortgage balance is $300,000.\n" +
      "Life insurance coverage with a death benefit of $500,000.\n" +
      "Spouse Jane, date of birth 1970-01-01.\nRetirement goal: retire at age 62.";
    expect(classifyDocument(text)).toBe("fact_finder");
  });

  it("detects a labelled-prose intake form", () => {
    const text =
      "Household Profile\nAnnual income: $120,000\nLiving expenses: $6,000/mo\n" +
      "Mortgage balance: $300,000\nLife insurance coverage: $500,000\n" +
      "Last will: executed 2019\nRetirement goal: age 62\nSpouse: Jane\n";
    expect(classifyDocument(text)).toBe("fact_finder");
  });

  it("still catches a terse-table fact finder that carries a vendor signature", () => {
    // The shape the structural tier now misses, rescued by tier 1. This is why
    // the KNOWN GAP is a gap and not an outage: real fact finders are branded.
    const text =
      "RightCapital\nSalary 120,000\nMortgage 412,000\nPremium 1,450\nWill Y\nSpouse Jane D\n";
    expect(classifyDocument(text)).toBe("fact_finder");
  });
});
