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
  | "real_estate"
  | "business"
  | "life_insurance";

export type AccountSubType =
  | "brokerage"
  | "savings"
  | "checking"
  | "traditional_ira"
  | "roth_ira"
  | "401k"
  | "roth_401k"
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

export interface ExtractedAccount {
  name: string;
  category?: AccountCategory;
  subType?: AccountSubType;
  owner?: "client" | "spouse" | "joint";
  value?: number;
  basis?: number;
  growthRate?: number | null;
  rmdEnabled?: boolean;
}

export interface ExtractedIncome {
  type?: IncomeType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
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

export interface ExtractionResult {
  documentType: DocumentType;
  fileName: string;
  extracted: {
    accounts: ExtractedAccount[];
    incomes: ExtractedIncome[];
    expenses: ExtractedExpense[];
    liabilities: ExtractedLiability[];
    entities: ExtractedEntity[];
  };
  warnings: string[];
  promptVersion: string;
}

export interface ExtractionRequest {
  documentType: DocumentType | "auto";
  model: "mini" | "full";
}
