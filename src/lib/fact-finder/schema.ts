/**
 * The fact finder — ONE definition every part of Fact Finder Import reads:
 * the screen, the three readers, the chat tools, and the placement map.
 *
 * It mirrors scripts/fact-finder/build_fact_finder.py. A PDF form field is
 * named `<pdfKey>_r<row>_c<pdfIndex>` (transposed sections: r = field, c =
 * policy), so `pdfIndex` is load-bearing:
 *   - NEVER renumber an existing pdfIndex. Copies of the PDF already in
 *     clients' hands would read into the wrong column.
 *   - New columns APPEND (next free pdfIndex), or are screen-only (no pdfIndex).
 * src/lib/fact-finder/__tests__/schema-pdf-alignment.test.ts enforces this
 * against the committed blank PDF.
 */

export type ColumnKind =
  | "text"
  | "notes"
  | "money"
  | "number"
  | "percent" // whole number: 6.5 means 6.5%
  | "integer"
  | "year"
  | "date" // ISO yyyy-mm-dd
  | "monthYear" // ISO yyyy-mm
  | "choice"
  | "check";

export interface FFColumn {
  id: string;
  label: string;
  kind: ColumnKind;
  options?: readonly string[];
  /** 1-based PDF column. Absent = screen-only column. */
  pdfIndex?: number;
}

export type FFPage =
  | "household"
  | "accounts"
  | "realEstateDebts"
  | "income"
  | "expensesSavings"
  | "insurance"
  | "estate";

export type FFLayout = "list" | "fixedRows" | "transposed" | "notes";

/** What kind of existing record a row in this section can link to. */
export type RecordKind =
  | "account"
  | "liability"
  | "familyMember"
  | "externalBeneficiary"
  | "income"
  | "expense"
  | "savingsRule"
  | "lifePolicy"
  | "disabilityPolicy"
  | "ltcPolicy"
  | "entity"
  | "gift"
  | "stockOptionGrant"
  | "noteReceivable";

export interface FFSection {
  id: string;
  page: FFPage;
  label: string;
  hint?: string;
  layout: FFLayout;
  /** fixedRows: the row labels. transposed: the entry (policy) count. */
  fixedRows?: readonly string[];
  entries?: number;
  columns: readonly FFColumn[];
  /** PDF field prefixes. Default [id]. living_items spans three. */
  pdfKeys?: readonly string[];
  /** Rows per PDF key (list layout). */
  pdfRows?: number;
  /** Present when rows link to an existing record ("Links to"). */
  links?: RecordKind;
  /** Account sections whose rows carry a nested holdings list. */
  holdings?: true;
}

// ---- option lists (labels match the app's dropdowns) -----------------------
export const YES_NO = ["Yes", "No"] as const;
export const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
] as const;
export const STATES = (
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT " +
  "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
).split(" ");
export const FILING = [
  "Single", "Married filing jointly", "Married filing separately", "Head of household",
] as const;
export const RELATIONSHIP = [
  "Child", "Stepchild", "Grandchild", "Great-grandchild", "Parent", "Grandparent",
  "Sibling", "Sibling-in-law", "Son/Daughter-in-law", "Niece/Nephew", "Aunt/Uncle",
  "Cousin", "Grand-aunt/uncle", "Other",
] as const;
export const DEPENDENT = ["Auto", "Yes", "No"] as const;
export const BENE_KIND = ["Charity", "Individual"] as const;
export const CHARITY_TYPE = ["Public charity", "Private foundation"] as const;
export const OWNER = ["Client", "Co-client", "Joint", "Trust / entity"] as const;
export const OWNER_PERSON = ["Client", "Co-client"] as const;
export const TITLING = ["JTWROS", "Community property"] as const;
export const CASH_TYPE = ["Checking", "Savings", "CD", "Money market", "Other"] as const;
export const TAXABLE_TYPE = ["Brokerage", "Trust", "Other"] as const;
export const RETIRE_TYPE = [
  "Traditional IRA", "Roth IRA", "401(k)", "403(b)", "401(a)", "SEP IRA", "SIMPLE IRA",
  "HSA", "Other",
] as const;
export const ANNUITY_TAX = ["Non-qualified", "Qualified", "Tax-free"] as const;
export const ANNUITY_PRODUCT = [
  "SPIA", "DIA", "MYGA", "Fixed", "Fixed indexed", "Variable", "QLAC",
] as const;
export const ANNUITY_INCOME = ["None", "Income rider (GLWB)", "Annuitized"] as const;
export const ANNUITY_PAYOUT = [
  "Single life", "Joint & survivor", "Life w/ period certain", "Period certain", "Cash refund",
] as const;
export const GRANT_TYPE = ["RSU", "NQSO", "ISO"] as const;
export const NOTE_PAY = ["Amortizing", "Interest-only, balloon"] as const;
export const PROPERTY_TYPE = [
  "Primary residence", "Rental property", "Commercial property",
] as const;
export const BUSINESS_TYPE = [
  "Sole proprietorship", "Partnership", "S-Corp", "C-Corp", "LLC", "Other",
] as const;
export const BUSINESS_TAX = ["QBI (pass-through)", "Ordinary income", "Non-taxable"] as const;
export const LIABILITY_TYPE = [
  "Mortgage", "HELOC", "Auto loan", "Student loan", "Personal loan", "Credit card", "Other",
] as const;
export const SS_SOURCE = [
  "Estimate from salary", "Benefit at full retirement age", "Stated benefit at age",
  "No benefit",
] as const;
export const SS_CLAIM = ["At full retirement age", "At retirement", "At a specific age"] as const;
export const SS_AGES = ["62", "63", "64", "65", "66", "67", "68", "69", "70"] as const;
export const INCOME_TYPE = ["Business", "Deferred comp", "Capital gains", "Trust", "Other"] as const;
export const INCOME_OWNER = ["Client", "Co-client", "Joint"] as const;
export const TAX_TYPE = [
  "Earned income", "Ordinary income", "Qualified dividends", "Capital gains", "QBI",
  "Tax-exempt", "Short-term gains", "Municipal bond interest",
] as const;
export const EXPENSE_TYPE = ["Living", "Insurance", "Education", "Other"] as const;
export const FREQ = ["Monthly", "Annually"] as const;
export const CONTRIB = ["Fixed $ amount", "% of salary", "IRS maximum"] as const;
export const POLICY_TYPE = ["Term", "Whole life", "Universal life", "Variable life"] as const;
export const INSURED = ["Client", "Co-client", "Joint (survivorship)"] as const;
export const POLICY_OWNER = ["Client", "Co-client", "Joint", "Trust / entity", "Other"] as const;
export const PAID_BY = ["Owner", "Client", "Co-client", "Both"] as const;
export const DI_EARNINGS = ["Salary", "Stated amount"] as const;
export const DI_RUNS = [
  "To age", "To SS normal retirement age", "For a number of years", "Lifetime",
] as const;
export const DI_PAYER = ["Employer", "Insured"] as const;
export const LTC_KIND = ["Traditional standalone", "Rider on a life policy"] as const;
export const LTC_PER = ["Day", "Month"] as const;
export const LTC_LAST = ["For a number of years", "Lifetime"] as const;
export const LTC_PAYS = ["Actual costs (reimbursement)", "Full limit (indemnity)"] as const;
export const LTC_INFL = ["None", "Simple", "Compound"] as const;
export const LTC_PREM = ["Lifetime", "To age", "For a number of years", "Paid up"] as const;
export const TRUST_TYPE = [
  "Revocable living trust", "Irrevocable", "ILIT", "IDGT", "CLT", "CRT",
] as const;
/** Spec § 8: the app stores client | spouse | none — "Joint" has no value. */
export const TRUST_GRANTOR = ["Client", "Co-client", "Someone else"] as const;
export const TRUST_ENDS = ["At client's death", "At co-client's death", "At second death"] as const;
export const WILL_OF = ["Client", "Co-client"] as const;
export const BEQUEST_KIND = ["Specific asset", "Remaining estate", "Debt (who pays)"] as const;
export const BEQUEST_COND = ["Always", "If co-client survives", "If co-client predeceases"] as const;
export const GIFT_FROM = ["Client", "Co-client", "Joint (split gift)"] as const;

const c = (
  id: string,
  label: string,
  kind: ColumnKind,
  pdfIndex: number | undefined,
  options?: readonly string[],
): FFColumn => ({ id, label, kind, pdfIndex, ...(options ? { options } : {}) });

/** Screen-only: names the trust/entity when Owner is "Trust / entity" (spec § 8). */
const ownerEntity = c("ownerEntity", "Which trust / entity", "text", undefined);

export const FACT_FINDER_SECTIONS: readonly FFSection[] = [
  // ======================= HOUSEHOLD ========================================
  {
    id: "meta", page: "household", label: "Prepared for", layout: "fixedRows",
    fixedRows: ["Household"],
    columns: [
      c("preparedFor", "Prepared for (household name)", "text", 1),
      c("advisor", "Advisor", "text", 2),
      c("dateCompleted", "Date completed", "date", 3),
    ],
  },
  {
    id: "people", page: "household", label: "Client & Co-client", layout: "fixedRows",
    fixedRows: ["Client", "Co-client"],
    columns: [
      c("firstName", "First name", "text", 1),
      c("lastName", "Last name", "text", 2),
      c("dateOfBirth", "Date of birth", "date", 3),
      c("retirementAge", "Retirement age", "integer", 4),
      c("retirementMonth", "Retirement month", "choice", 5, MONTHS),
      c("planToAge", "Plan to age (life expectancy)", "integer", 6),
      c("email", "Email", "text", 7),
      c("phone", "Phone", "text", 8),
      c("mobile", "Mobile", "text", 9),
      c("coveredByWorkplacePlan", "Covered by workplace retirement plan?", "choice", 10, YES_NO),
    ],
  },
  {
    id: "household", page: "household", label: "Household", layout: "fixedRows",
    fixedRows: ["Household"],
    columns: [
      c("filingStatus", "Tax filing status", "choice", 1, FILING),
      c("stateOfResidence", "State of residence", "choice", 2, STATES),
      c("street", "Street address", "text", 3),
      c("address2", "Address line 2", "text", 4),
      c("city", "City", "text", 5),
      c("state", "State", "choice", 6, STATES),
      c("zip", "ZIP", "text", 7),
    ],
  },
  {
    id: "family", page: "household", label: "Children, Grandchildren & Other Heirs",
    layout: "list", pdfRows: 8, links: "familyMember",
    columns: [
      c("firstName", "First name", "text", 1),
      c("lastName", "Last name", "text", 2),
      c("relationship", "Relationship", "choice", 3, RELATIONSHIP),
      c("dateOfBirth", "Date of birth", "date", 4),
      c("claimedAsDependent", "Claimed as dependent?", "choice", 5, DEPENDENT),
      c("domesticPartner", "Domestic partner", "check", 6),
      c("notes", "Notes", "notes", 7),
    ],
  },
  {
    id: "external", page: "household", label: "Charities & Other Beneficiaries",
    hint: "People or organizations outside the family who may receive assets",
    layout: "list", pdfRows: 3, links: "externalBeneficiary",
    columns: [
      c("name", "Name", "text", 1),
      c("kind", "Kind", "choice", 2, BENE_KIND),
      c("charityType", "Charity type", "choice", 3, CHARITY_TYPE),
      c("notes", "Notes", "notes", 4),
    ],
  },
  // ======================= ACCOUNTS =========================================
  {
    id: "cash", page: "accounts", label: "Cash Accounts", layout: "list", pdfRows: 5,
    links: "account",
    columns: [
      c("accountName", "Account name", "text", 1),
      c("currentValue", "Current value", "money", 2),
      c("last4", "Last 4", "text", 3),
      c("owner", "Owner", "choice", 4, OWNER),
      c("jointTitling", "Joint titling", "choice", 5, TITLING),
      c("custodian", "Custodian", "text", 6),
      c("accountType", "Account type", "choice", 7, CASH_TYPE),
      c("interestRate", "Interest rate %", "percent", 8),
      ownerEntity,
    ],
  },
  {
    id: "taxable", page: "accounts", label: "Taxable Investment Accounts", layout: "list",
    pdfRows: 6, links: "account", holdings: true,
    columns: [
      c("accountName", "Account name", "text", 1),
      c("currentValue", "Current value", "money", 2),
      c("costBasis", "Cost basis", "money", 3),
      c("last4", "Last 4", "text", 4),
      c("owner", "Owner", "choice", 5, OWNER),
      c("jointTitling", "Joint titling", "choice", 6, TITLING),
      c("custodian", "Custodian", "text", 7),
      c("accountType", "Account type", "choice", 8, TAXABLE_TYPE),
      ownerEntity,
      // Screen-only: a statement reads them; the printed form has no room.
      c("marginLoan", "Margin loan", "money", undefined),
      c("marginRate", "Margin rate %", "percent", undefined),
    ],
  },
  {
    id: "retirement", page: "accounts", label: "Retirement Accounts",
    hint: "Owner is one person — retirement accounts can't be joint. List contributions under Planned Savings.",
    layout: "list", pdfRows: 7, links: "account", holdings: true,
    columns: [
      c("accountName", "Account name", "text", 1),
      c("currentValue", "Current value", "money", 2),
      c("rothPortion", "Roth portion (401k/403b)", "money", 3),
      c("afterTaxBasis", "After-tax basis (IRA)", "money", 4),
      c("last4", "Last 4", "text", 5),
      c("owner", "Owner", "choice", 6, OWNER_PERSON),
      c("custodian", "Custodian", "text", 7),
      c("accountType", "Account type", "choice", 8, RETIRE_TYPE),
      c("inherited", "Inherited?", "choice", 9, YES_NO),
      c("priorYearEndValue", "Prior year-end value", "money", 10),
      c("primaryBeneficiary", "Primary beneficiary", "text", 11),
      c("contingentBeneficiary", "Contingent beneficiary", "text", 12),
      // spec § 8 — appended, never inserted
      c("originalOwnerBirthYear", "Original owner's birth year", "year", 13),
      c("originalOwnerDeathYear", "Original owner's year of death", "year", 14),
    ],
  },
  {
    id: "annuity", page: "accounts", label: "Annuities", layout: "list", pdfRows: 4,
    links: "account",
    columns: [
      c("contractName", "Contract name", "text", 1),
      c("cashValue", "Cash value", "money", 2),
      c("costBasis", "Cost basis", "money", 3),
      c("last4", "Last 4", "text", 4),
      c("owner", "Owner", "choice", 5, OWNER),
      c("carrier", "Carrier / custodian", "text", 6),
      c("taxTreatment", "Tax treatment", "choice", 7, ANNUITY_TAX),
      c("productType", "Product type", "choice", 8, ANNUITY_PRODUCT),
      c("income", "Income", "choice", 9, ANNUITY_INCOME),
      c("payoutStructure", "Payout structure", "choice", 10, ANNUITY_PAYOUT),
      ownerEntity,
    ],
  },
  {
    id: "edu", page: "accounts", label: "529 / Education Savings", layout: "list", pdfRows: 4,
    links: "account", holdings: true,
    columns: [
      c("accountName", "Account name", "text", 1),
      c("currentValue", "Current value", "money", 2),
      c("basis", "Basis (contributions)", "money", 3),
      c("last4", "Last 4", "text", 4),
      c("owner", "Owner", "choice", 5, OWNER),
      c("custodian", "Custodian", "text", 6),
      c("beneficiary", "Beneficiary (student)", "text", 7),
      c("grantor", "Grantor (who funded it)", "text", 8),
    ],
  },
  {
    id: "equity", page: "accounts", label: "Stock Options & Equity Awards", layout: "list",
    pdfRows: 4, links: "stockOptionGrant",
    columns: [
      c("company", "Company / plan", "text", 1),
      c("ticker", "Ticker", "text", 2),
      c("grantType", "Grant type", "choice", 3, GRANT_TYPE),
      c("grantNumber", "Grant #", "text", 4),
      c("grantDate", "Grant date", "date", 5),
      c("sharesGranted", "Shares granted", "number", 6),
      c("strikePrice", "Strike price", "money", 7),
      c("expirationDate", "Expiration date", "date", 8),
      c("vestingSchedule", "Vesting schedule", "text", 9),
      c("owner", "Owner", "choice", 10, OWNER_PERSON),
    ],
  },
  {
    id: "notes_rec", page: "accounts", label: "Notes Receivable",
    hint: "Money owed to you, e.g. a loan to family or from a business sale",
    layout: "list", pdfRows: 3, links: "noteReceivable",
    columns: [
      c("borrower", "Name / borrower", "text", 1),
      c("originalAmount", "Original amount", "money", 2),
      c("currentBalance", "Current balance", "money", 3),
      c("balanceAsOf", "Balance as of (mo/yr)", "monthYear", 4),
      c("interestRate", "Interest rate %", "percent", 5),
      c("paymentType", "Payment type", "choice", 6, NOTE_PAY),
      c("monthlyPayment", "Monthly payment", "money", 7),
      c("start", "Start (mo/yr)", "monthYear", 8),
      c("termMonths", "Term (months)", "integer", 9),
      c("owner", "Owner", "choice", 10, OWNER),
      ownerEntity,
    ],
  },
  // ======================= REAL ESTATE, BUSINESS & DEBTS ====================
  {
    id: "realestate", page: "realEstateDebts", label: "Real Estate", layout: "list",
    pdfRows: 5, links: "account",
    columns: [
      c("propertyName", "Property name", "text", 1),
      c("propertyType", "Property type", "choice", 2, PROPERTY_TYPE),
      c("currentValue", "Current value", "money", 3),
      c("costBasis", "Cost basis", "money", 4),
      c("owner", "Owner", "choice", 5, OWNER),
      c("jointTitling", "Joint titling", "choice", 6, TITLING),
      c("address", "Address", "text", 7),
      c("annualPropertyTax", "Annual property tax", "money", 8),
      c("mortgageName", "Mortgage on it (name)", "text", 9),
      ownerEntity,
    ],
  },
  {
    id: "business", page: "realEstateDebts", label: "Business Interests", layout: "list",
    pdfRows: 4, links: "account",
    columns: [
      c("businessName", "Business name", "text", 1),
      c("businessType", "Business type", "choice", 2, BUSINESS_TYPE),
      c("currentValue", "Current value", "money", 3),
      c("costBasis", "Cost basis", "money", 4),
      c("ownersAndPercent", "Owner(s) & %", "text", 5),
      c("taxTreatment", "Tax treatment", "choice", 6, BUSINESS_TAX),
      // spec § 8: relabelled — the app stores a share of EARNINGS, not of value
      c("distributionPercent", "Share of earnings distributed %", "percent", 7),
      c("annualIncome", "Annual income", "money", 8),
      c("annualExpense", "Annual expense", "money", 9),
    ],
  },
  {
    id: "liab", page: "realEstateDebts", label: "Liabilities",
    hint: "Mortgages, HELOCs, auto, student, personal loans, credit cards",
    layout: "list", pdfRows: 7, links: "liability",
    columns: [
      c("loanName", "Loan name", "text", 1),
      c("type", "Type", "choice", 2, LIABILITY_TYPE),
      c("owner", "Owner", "choice", 3, OWNER),
      c("balance", "Balance", "money", 4),
      c("balanceAsOf", "Balance as of", "monthYear", 5),
      c("interestRate", "Interest rate %", "percent", 6),
      c("monthlyPI", "Monthly P&I", "money", 7),
      c("monthlyEscrow", "Monthly escrow (tax/ins.)", "money", 8),
      c("loanStart", "Loan start (mo/yr)", "monthYear", 9),
      c("termYears", "Term (years)", "integer", 10),
      c("matures", "Matures", "monthYear", 11),
      c("interestDeductible", "Interest deductible?", "choice", 12, YES_NO),
      c("propertyName", "Property it's on", "text", 13),
      ownerEntity,
    ],
  },
  // ======================= INCOME ===========================================
  {
    id: "salary", page: "income", label: "Salary & Wages", hint: "End year blank = stops at retirement",
    layout: "fixedRows", fixedRows: ["Client", "Co-client"], links: "income",
    columns: [
      c("employer", "Employer", "text", 1),
      c("annualSalary", "Annual salary", "money", 2),
      c("annualRaise", "Annual raise %", "percent", 3),
      c("startYear", "Start year", "year", 4),
      c("endYear", "End year", "year", 5),
    ],
  },
  {
    id: "ss", page: "income", label: "Social Security",
    hint: "A copy of each ssa.gov statement is the best source",
    layout: "fixedRows", fixedRows: ["Client", "Co-client"], links: "income",
    columns: [
      c("benefitSource", "How should we set the benefit?", "choice", 1, SS_SOURCE),
      c("monthlyBenefit", "Monthly benefit $", "money", 2),
      c("benefitStatedAtAge", "Benefit stated at age", "integer", 3),
      c("whenToClaim", "When to claim", "choice", 4, SS_CLAIM),
      c("claimAgeYears", "Claim age (years)", "choice", 5, SS_AGES),
      c("claimAgeMonths", "Claim age (+ months)", "integer", 6),
      c("cola", "Annual COLA %", "percent", 7),
    ],
  },
  {
    id: "income", page: "income", label: "Other Income",
    hint: "Pensions (type: Other), deferred comp, business, trust distributions, rental income, etc.",
    layout: "list", pdfRows: 7, links: "income",
    columns: [
      c("incomeName", "Income name", "text", 1),
      c("type", "Type", "choice", 2, INCOME_TYPE),
      c("owner", "Owner", "choice", 3, INCOME_OWNER),
      c("annualAmount", "Annual amount", "money", 4),
      c("annualIncrease", "Annual increase %", "percent", 5),
      c("startYear", "Start year", "year", 6),
      c("endYear", "End year", "year", 7),
      c("taxType", "Tax type", "choice", 8, TAX_TYPE),
      c("paidInMonth", "Paid in month (if once a year)", "choice", 9, MONTHS),
      c("survivorContinues", "Survivor continues %", "percent", 10),
    ],
  },
  // ======================= EXPENSES & SAVINGS ===============================
  {
    id: "living", page: "expensesSavings", label: "Living Expenses",
    hint: "Growth blank = general inflation",
    layout: "fixedRows", fixedRows: ["Current", "In retirement"], links: "expense",
    columns: [
      c("annualAmount", "Annual amount", "money", 1),
      c("annualIncrease", "Annual increase %", "percent", 2),
      c("startYear", "Start year", "year", 3),
      c("endYear", "End year", "year", 4),
      c("notes", "Notes", "notes", 5),
    ],
  },
  {
    id: "living_items", page: "expensesSavings", label: "Itemized Current Living Expenses",
    hint: "Don't include loan payments or insurance premiums listed elsewhere",
    layout: "list", pdfKeys: ["living_items1", "living_items2", "living_items3"], pdfRows: 5,
    columns: [
      c("item", "Item", "text", 1),
      c("amount", "Amount", "money", 2),
      c("frequency", "Frequency", "choice", 3, FREQ),
    ],
  },
  {
    id: "expenses", page: "expensesSavings", label: "Other Expenses",
    hint: "Education, travel goals, care for a parent, large purchases, etc.",
    layout: "list", pdfRows: 5, links: "expense",
    columns: [
      c("expenseName", "Expense name", "text", 1),
      c("type", "Type", "choice", 2, EXPENSE_TYPE),
      c("annualAmount", "Annual amount", "money", 3),
      c("annualIncrease", "Annual increase %", "percent", 4),
      c("startYear", "Start year", "year", 5),
      c("endYear", "End year", "year", 6),
      c("isGoal", "A goal?", "check", 7),
      c("notes", "Notes", "notes", 8),
    ],
  },
  {
    id: "savings", page: "expensesSavings", label: "Planned Savings",
    hint: "Ongoing contributions to any account above",
    layout: "list", pdfRows: 5, links: "savingsRule",
    columns: [
      c("account", "Account", "text", 1),
      c("contribution", "Contribution", "choice", 2, CONTRIB),
      c("annualAmount", "Annual $", "money", 3),
      c("percentOfSalary", "% of salary", "percent", 4),
      c("rothPercent", "Roth % (401k/403b)", "percent", 5),
      c("employerMatch", "Employer match %", "percent", 6),
      c("matchUpTo", "Match up to (% of salary)", "percent", 7),
      c("employerFlat", "Employer flat $", "money", 8),
      c("startYear", "Start year", "year", 9),
      c("endYear", "End year", "year", 10),
      c("annualIncrease", "Annual increase %", "percent", 11),
    ],
  },
  // ======================= INSURANCE ========================================
  {
    id: "life", page: "insurance", label: "Life Insurance",
    hint: "Attach the latest annual statement or in-force illustration",
    layout: "transposed", entries: 5, links: "lifePolicy",
    columns: [
      c("policyName", "Policy name", "text", 1),
      c("carrier", "Carrier", "text", 2),
      c("policyType", "Policy type", "choice", 3, POLICY_TYPE),
      c("insured", "Insured", "choice", 4, INSURED),
      c("owner", "Owner", "choice", 5, POLICY_OWNER),
      c("deathBenefit", "Death benefit", "money", 6),
      c("cashValue", "Current cash value", "money", 7),
      c("costBasis", "Cost basis (premiums paid)", "money", 8),
      c("annualPremium", "Annual premium", "money", 9),
      c("premiumPaidBy", "Premium paid by", "choice", 10, PAID_BY),
      c("premiumPaymentYears", "Premium payment years", "integer", 11),
      c("termIssueYear", "Term: issue year", "year", 12),
      c("termLengthYears", "Term: length (years)", "integer", 13),
      c("termEndsAtRetirement", "Term ends at insured's retirement?", "choice", 14, YES_NO),
      c("policyNumber", "Policy #", "text", 15),
      c("primaryBeneficiary", "Primary beneficiary", "text", 16),
      c("contingentBeneficiary", "Contingent beneficiary", "text", 17),
      ownerEntity,
    ],
  },
  {
    id: "insurance_notes", page: "insurance", label: "Group / employer coverage & notes",
    layout: "notes", columns: [c("notes", "Notes", "notes", undefined)],
  },
  {
    id: "disability", page: "insurance", label: "Disability Insurance", layout: "transposed",
    entries: 2, links: "disabilityPolicy",
    columns: [
      c("policyName", "Policy name", "text", 1),
      c("carrier", "Carrier", "text", 2),
      c("whoIsCovered", "Who is covered", "choice", 3, OWNER_PERSON),
      c("coveredEarnings", "Covered earnings", "choice", 4, DI_EARNINGS),
      c("coveredEarningsAmount", "Covered earnings amount", "money", 5),
      c("shortTerm", "Short-term coverage?", "choice", 6, YES_NO),
      c("stdWaitingDays", "STD waiting period (days)", "integer", 7),
      c("stdBenefitPercent", "STD benefit (% of earnings)", "percent", 8),
      c("stdDurationWeeks", "STD duration (weeks)", "integer", 9),
      c("stdMonthlyCap", "STD monthly cap", "money", 10),
      c("longTerm", "Long-term coverage?", "choice", 11, YES_NO),
      c("ltdWaitingDays", "LTD waiting period (days)", "integer", 12),
      c("ltdBenefitPercent", "LTD benefit (% of earnings)", "percent", 13),
      c("ltdMonthlyCap", "LTD monthly cap", "money", 14),
      c("benefitsRun", "Benefits run", "choice", 15, DI_RUNS),
      c("benefitsRunValue", "…to age / for years", "integer", 16),
      c("benefitsTaxable", "Benefits taxable?", "choice", 17, YES_NO),
      c("annualIncrease", "Annual increase %", "percent", 18),
      c("annualPremium", "Annual premium", "money", 19),
      c("premiumPayer", "Who pays the premium", "choice", 20, DI_PAYER),
    ],
  },
  {
    id: "ltc", page: "insurance", label: "Long-Term Care Insurance", layout: "transposed",
    entries: 2, links: "ltcPolicy",
    columns: [
      c("policyName", "Policy name", "text", 1),
      c("carrier", "Carrier", "text", 2),
      c("whoIsCovered", "Who is covered", "choice", 3, OWNER_PERSON),
      c("policyType", "Policy type", "choice", 4, LTC_KIND),
      c("riderLifePolicy", "Life policy (if rider)", "text", 5),
      c("issueYear", "Issue year", "year", 6),
      c("benefitAmount", "Benefit amount", "money", 7),
      c("benefitPer", "Benefit per", "choice", 8, LTC_PER),
      c("benefitsLast", "Benefits last", "choice", 9, LTC_LAST),
      c("benefitYears", "Benefit years", "integer", 10),
      c("waitingDays", "Waiting period (days)", "integer", 11),
      c("homeCarePercent", "Home care pays (% of limit)", "percent", 12),
      c("policyPays", "Policy pays", "choice", 13, LTC_PAYS),
      c("sharedCare", "Shared care?", "choice", 14, YES_NO),
      c("statePartnership", "State partnership policy?", "choice", 15, YES_NO),
      c("inflationProtection", "Inflation protection", "choice", 16, LTC_INFL),
      c("inflationRate", "Inflation rate %", "percent", 17),
      c("annualPremium", "Annual premium", "money", 18),
      c("premiumsPaid", "Premiums paid", "choice", 19, LTC_PREM),
      c("premiumsPaidValue", "…to age / for years", "integer", 20),
    ],
  },
  // ======================= ESTATE ===========================================
  {
    id: "estate_docs", page: "estate", label: "Documents in Place",
    hint: "Check each one that exists today",
    layout: "fixedRows", fixedRows: ["Client", "Co-client"],
    columns: [
      c("will", "Will", "check", 1),
      c("revocableTrust", "Revocable living trust", "check", 2),
      c("ilit", "ILIT", "check", 3),
      c("idgt", "IDGT", "check", 4),
      c("clt", "CLT", "check", 5),
      c("crt", "CRT", "check", 6),
      c("otherIrrevocable", "Other irrevocable trust", "check", 7),
      c("lastUpdatedYear", "Last updated (year)", "year", 8),
      c("estateAttorney", "Estate attorney", "text", 9),
    ],
  },
  {
    id: "trusts", page: "estate", label: "Trusts", layout: "list", pdfRows: 5, links: "entity",
    columns: [
      c("trustName", "Trust name", "text", 1),
      c("trustType", "Trust type", "choice", 2, TRUST_TYPE),
      c("grantor", "Grantor", "choice", 3, TRUST_GRANTOR),
      c("trustee", "Trustee", "text", 4),
      c("grantorTrust", "Grantor trust (you pay its tax)?", "choice", 5, YES_NO),
      c("crummey", "Crummey powers?", "choice", 6, YES_NO),
      c("trustEnds", "Trust ends", "choice", 7, TRUST_ENDS),
      c("incomeBeneficiaries", "Income beneficiaries", "text", 8),
      c("remainderBeneficiaries", "Remainder beneficiaries", "text", 9),
    ],
  },
  {
    id: "bequests", page: "estate", label: "Will Provisions",
    hint: "Specific gifts first, then who receives the rest",
    layout: "list", pdfRows: 6,
    columns: [
      c("willOf", "Will of", "choice", 1, WILL_OF),
      c("gift", "Gift", "choice", 2, BEQUEST_KIND),
      c("asset", "Asset / account / debt", "text", 3),
      c("percent", "% of it", "percent", 4),
      c("recipients", "Recipient(s) & shares", "text", 5),
      c("condition", "Condition", "choice", 6, BEQUEST_COND),
    ],
  },
  {
    id: "gifts", page: "estate", label: "Prior Lifetime Gifts",
    hint: "Gifts above the annual exclusion, or any gift to a trust",
    layout: "list", pdfRows: 4, links: "gift",
    columns: [
      c("year", "Year", "year", 1),
      c("from", "From", "choice", 2, GIFT_FROM),
      c("recipient", "Recipient (person or trust)", "text", 3),
      c("given", "Cash or asset given", "text", 4),
      c("amount", "Amount / value", "money", 5),
      c("form709Filed", "Gift tax return (709) filed?", "choice", 6, YES_NO),
    ],
  },
  {
    id: "final_notes", page: "estate", label: "Anything else we should know?",
    layout: "notes", columns: [c("notes", "Notes", "notes", undefined)],
  },
];

/** PDF page 10 — read by Reader 1 only; holdings live under account rows on screen. */
export const PDF_HOLDINGS_TABLE = {
  pdfKey: "holdings",
  pdfRows: 19,
  columns: [
    c("account", "Account (name or last 4)", "text", 1),
    c("ticker", "Ticker", "text", 2),
    c("securityName", "Security name", "text", 3),
    c("shares", "Shares", "number", 4),
    c("price", "Price", "money", 5),
    c("marketValue", "Market value", "money", 6),
    c("costBasis", "Cost basis", "money", 7),
  ],
} as const;

const BY_ID = new Map(FACT_FINDER_SECTIONS.map((s) => [s.id, s]));

export function findSection(id: string): FFSection | undefined {
  return BY_ID.get(id);
}

export function findColumn(sectionId: string, columnId: string): FFColumn | undefined {
  return BY_ID.get(sectionId)?.columns.find((col) => col.id === columnId);
}

/** The single row label a `notes` section stores its text under. */
export const NOTES_ROW_LABEL = "Notes";

/**
 * Labels of the rows a section always has. `fixedRows` sections list theirs
 * ("Client", "Co-client"); a `notes` section has one; list and transposed
 * sections have none (their rows come and go).
 */
export function fixedLabelsOf(section: FFSection): readonly string[] {
  if (section.layout === "fixedRows") return section.fixedRows ?? [];
  if (section.layout === "notes") return [NOTES_ROW_LABEL];
  return [];
}

/** A list or transposed section: its rows come and go (added, removed, merged). */
export function isListLike(section: FFSection): boolean {
  return section.layout === "list" || section.layout === "transposed";
}

/** PDF field prefixes for a section. Itemized living expenses span three. */
export function pdfKeysOf(section: FFSection): readonly string[] {
  return section.pdfKeys ?? [section.id];
}

/** Sections whose rows link to records of one kind, in schema order. */
export function sectionsLinkingTo(kind: RecordKind): FFSection[] {
  return FACT_FINDER_SECTIONS.filter((s) => s.links === kind);
}
