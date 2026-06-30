import type { GrowthSource } from "@/lib/investments/allocation";
import type { AccountOwner } from "@/engine/ownership";
import type { YearRef } from "@/lib/milestones";

export const DOCUMENT_TYPES = [
  "account_statement",
  "pay_stub",
  "insurance",
  "expense_worksheet",
  "tax_return",
  "excel_import",
  "fact_finder",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  account_statement: "Account Statement",
  pay_stub: "Pay Stub",
  insurance: "Insurance",
  expense_worksheet: "Expense Worksheet",
  tax_return: "Tax Return",
  excel_import: "Excel Import",
  fact_finder: "Fact Finder",
};

export type AccountCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "annuity"
  | "real_estate"
  | "business"
  | "life_insurance"
  | "notes_receivable"
  | "stock_options";

export type AccountSubType =
  | "brokerage"
  | "savings"
  | "checking"
  | "traditional_ira"
  | "roth_ira"
  | "401k"
  | "403b"
  | "529"
  | "trust"
  | "other"
  | "primary_residence"
  | "rental_property"
  | "commercial_property"
  | "sole_proprietorship"
  | "partnership"
  | "s_corp"
  | "c_corp"
  | "llc"
  | "term"
  | "whole_life"
  | "universal_life"
  | "variable_life";

export type IncomeType =
  | "salary"
  | "social_security"
  | "business"
  | "deferred"
  | "capital_gains"
  | "trust"
  | "other";

export type ExpenseType = "living" | "other" | "insurance";

export type EntityType =
  | "trust"
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "foundation"
  | "other";

/**
 * One position within an account, when holdings extraction is enabled.
 * Tickered holdings are classified + live-priced at commit; untickered
 * holdings (bonds, untickered funds, cash) are stored manual using the
 * statement's own numbers, with the description (incl. any CUSIP) in `name`.
 */
export interface ExtractedHolding {
  /** Ticker / symbol as written on the statement; omitted for bonds/cash. */
  ticker?: string;
  /** Description / name; for bonds include the CUSIP; cash = "Cash". */
  name?: string;
  /** Quantity of shares / units. */
  shares?: number;
  /** Per-share price. */
  price?: number;
  /** Total market value of the position. */
  marketValue?: number;
  /** Cost basis of the position. */
  costBasis?: number;
}

export interface ExtractedAccount {
  name: string;
  category?: AccountCategory;
  subType?: AccountSubType;
  owner?: "client" | "spouse" | "joint";
  value?: number;
  basis?: number;
  growthRate?: number | null;
  rmdEnabled?: boolean;
  accountNumberLast4?: string;
  custodian?: string;
  growthSource?: GrowthSource;
  modelPortfolioId?: string | null;
  tickerPortfolioId?: string | null;
  ownerNameHint?: string;
  owners?: AccountOwner[];
  /** Individual positions, present only when holdings extraction was enabled. */
  holdings?: ExtractedHolding[];
  /** Set when the account originated from a third-party sync (e.g. Orion). */
  externalProvider?: string;
  externalId?: string;
}

export interface ExtractedIncome {
  type?: IncomeType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
  /** Dynamic timing anchor for the start year (e.g. client_retirement). */
  startYearRef?: YearRef;
  /** Dynamic timing anchor for the end year (e.g. client_end). */
  endYearRef?: YearRef;
  growthRate?: number;
  owner?: "client" | "spouse" | "joint";
  claimingAge?: number;
}

export interface ExtractedExpense {
  type?: ExpenseType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
  /** Dynamic timing anchor for the start year. */
  startYearRef?: YearRef;
  /** Dynamic timing anchor for the end year. */
  endYearRef?: YearRef;
  growthRate?: number;
}

export interface ExtractedLiability {
  name: string;
  balance?: number;
  interestRate?: number;
  monthlyPayment?: number;
  startYear?: number;
  endYear?: number;
}

export interface ExtractedEntity {
  name: string;
  entityType?: EntityType;
}

export type FilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household";

export type FamilyRelationship =
  | "child"
  | "grandchild"
  | "parent"
  | "sibling"
  | "other";

export type FamilyMemberRole = "child" | "other";

export interface ExtractedPrimaryFamilyMember {
  firstName: string;
  lastName?: string;
  dateOfBirth?: string;
  filingStatus?: FilingStatus;
}

export interface ExtractedSpouseFamilyMember {
  firstName: string;
  lastName?: string;
  dateOfBirth?: string;
}

export interface ExtractedDependent {
  firstName: string;
  lastName?: string;
  dateOfBirth?: string;
  relationship?: FamilyRelationship;
  role?: FamilyMemberRole;
}

export interface ExtractedFamilyPayload {
  primary?: ExtractedPrimaryFamilyMember;
  spouse?: ExtractedSpouseFamilyMember;
  dependents?: ExtractedDependent[];
}

export type LifePolicyType = "term" | "whole" | "universal" | "variable";

export interface ExtractedLifePolicy {
  carrier?: string;
  policyNumberLast4?: string;
  policyType: LifePolicyType;
  insuredPerson: "client" | "spouse" | "joint";
  faceValue: number;
  /** Cash / surrender value of the policy, when shown alongside the face
   *  value (e.g. on a net-worth statement). Becomes the account row's value. */
  cashValue?: number;
  costBasis?: number;
  premiumAmount?: number;
  premiumYears?: number;
  termIssueYear?: number;
  termLengthYears?: number;
  accountName: string;
}

export type WillBequestCondition = "none" | "if_predeceased" | "per_stirpes";

export interface ExtractedWillBequest {
  recipientNameHint: string;
  assetDescriptionHint: string;
  percentage: number;
  condition?: WillBequestCondition;
}

export interface ExtractedWill {
  grantor: "client" | "spouse";
  executor?: string;
  executionDate?: string;
  bequests: ExtractedWillBequest[];
}

export interface ExtractionResult {
  documentType: DocumentType;
  fileName: string;
  extracted: {
    accounts: ExtractedAccount[];
    incomes: ExtractedIncome[];
    expenses: ExtractedExpense[];
    liabilities: ExtractedLiability[];
    entities: ExtractedEntity[];
    family?: ExtractedFamilyPayload;
    lifePolicies: ExtractedLifePolicy[];
    wills: ExtractedWill[];
  };
  warnings: string[];
  promptVersion: string;
}

export interface ExtractionRequest {
  documentType: DocumentType | "auto";
  model: "mini" | "full";
}
