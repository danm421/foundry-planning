/**
 * Pure, server-free field-label tables for the audit/activity feed.
 *
 * These live apart from the snapshot builders in `./snapshots/*` on purpose:
 * the snapshot files `import { db } from "@/db"` (which opens a Pool at module
 * load), so anything transitively reaching them drags `drizzle-orm` +
 * `@neondatabase/serverless` into that bundle. The client-side activity feed
 * only needs the *labels*, not the builders — so it imports from here, where
 * the only dependency is the `FieldLabels` type (erased at runtime).
 *
 * The snapshot files re-export their matching const from this file, so
 * server-side callers can keep importing `{ toXSnapshot, X_FIELD_LABELS }`
 * from one place. (audit F3)
 */
import type { FieldLabels } from "./types";

export const ACCOUNT_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  category: { label: "Category", format: "text" },
  subType: { label: "Subtype", format: "text" },
  value: { label: "Account value", format: "currency" },
  basis: { label: "Cost basis", format: "currency" },
  rothValue: { label: "Roth value", format: "currency" },
  growthRate: { label: "Growth rate", format: "percent" },
  rmdEnabled: { label: "RMD enabled", format: "text" },
  priorYearEndValue: { label: "Prior year-end balance", format: "currency" },
  isDefaultChecking: { label: "Default checking", format: "text" },
  growthSource: { label: "Growth source", format: "text" },
  modelPortfolio: { label: "Model portfolio", format: "reference" },
  tickerPortfolio: { label: "Fund portfolio", format: "reference" },
  turnoverPct: { label: "Turnover %", format: "percent" },
  annualPropertyTax: { label: "Annual property tax", format: "currency" },
  propertyTaxGrowthRate: { label: "Property tax growth", format: "percent" },
  propertyTaxGrowthSource: { label: "Property tax growth source", format: "text" },
  titlingType: { label: "Titling type", format: "text" },
  hsaCoverage: { label: "HSA coverage", format: "text" },
  source: { label: "Source", format: "text" },
};

export const ASSET_TRANSACTION_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  type: { label: "Type", format: "text" },
  year: { label: "Year", format: "text" },
  account: { label: "Account", format: "reference" },
  overrideSaleValue: { label: "Override sale value", format: "currency" },
  overrideBasis: { label: "Override basis", format: "currency" },
  transactionCostPct: { label: "Transaction cost %", format: "percent" },
  transactionCostFlat: { label: "Transaction cost (flat)", format: "currency" },
  proceedsAccount: { label: "Proceeds account", format: "reference" },
  qualifiesForHomeSaleExclusion: {
    label: "Home sale exclusion",
    format: "text",
  },
  assetName: { label: "Asset name", format: "text" },
  assetCategory: { label: "Asset category", format: "text" },
  assetSubType: { label: "Asset subtype", format: "text" },
  purchasePrice: { label: "Purchase price", format: "currency" },
  growthRate: { label: "Growth rate", format: "percent" },
  growthSource: { label: "Growth source", format: "text" },
  modelPortfolio: { label: "Model portfolio", format: "reference" },
  basis: { label: "Cost basis", format: "currency" },
  fundingAccount: { label: "Funding account", format: "reference" },
  mortgageAmount: { label: "Mortgage amount", format: "currency" },
  mortgageRate: { label: "Mortgage rate", format: "percent" },
  mortgageTermMonths: { label: "Mortgage term (months)", format: "text" },
  businessAccount: { label: "Business sold", format: "reference" },
};

export const LIABILITY_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  balance: { label: "Balance", format: "currency" },
  balanceAsOfMonth: { label: "Balance as-of month", format: "text" },
  balanceAsOfYear: { label: "Balance as-of year", format: "text" },
  interestRate: { label: "Interest rate", format: "percent" },
  monthlyPayment: { label: "Monthly payment", format: "currency" },
  startYear: { label: "Start year", format: "text" },
  startMonth: { label: "Start month", format: "text" },
  startYearRef: { label: "Start year ref", format: "text" },
  termMonths: { label: "Term (months)", format: "text" },
  termUnit: { label: "Term unit", format: "text" },
  linkedProperty: { label: "Linked property", format: "reference" },
  isInterestDeductible: { label: "Interest deductible", format: "text" },
};

export const EXTRA_PAYMENT_FIELD_LABELS: FieldLabels = {
  liability: { label: "Liability", format: "reference" },
  year: { label: "Year", format: "text" },
  type: { label: "Type", format: "text" },
  amount: { label: "Amount", format: "currency" },
};

export const TRANSFER_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  sourceAccount: { label: "Source account", format: "reference" },
  targetAccount: { label: "Target account", format: "reference" },
  amount: { label: "Amount", format: "currency" },
  mode: { label: "Mode", format: "text" },
  startYear: { label: "Start year", format: "text" },
  startYearRef: { label: "Start year ref", format: "text" },
  endYear: { label: "End year", format: "text" },
  endYearRef: { label: "End year ref", format: "text" },
  growthRate: { label: "Growth rate", format: "percent" },
};

export const CLIENT_FIELD_LABELS: FieldLabels = {
  retirementAge: { label: "Retirement age", format: "text" },
  retirementMonth: { label: "Retirement month", format: "text" },
  planEndAge: { label: "Plan end age", format: "text" },
  lifeExpectancy: { label: "Life expectancy", format: "text" },
  spouseRetirementAge: { label: "Spouse retirement age", format: "text" },
  spouseRetirementMonth: { label: "Spouse retirement month", format: "text" },
  spouseLifeExpectancy: { label: "Spouse life expectancy", format: "text" },
  filingStatus: { label: "Filing status", format: "text" },
  riskTolerance: { label: "Risk tolerance", format: "text" },
};

/** CRM household contact (`crm_household_contacts`). `ssnLast4` and
 *  `dateOfBirth` are marked sensitive so the activity feed records that they
 *  changed without ever persisting the values. */
export const CRM_CONTACT_FIELD_LABELS: FieldLabels = {
  firstName: { label: "First name", format: "text" },
  lastName: { label: "Last name", format: "text" },
  preferredName: { label: "Preferred name", format: "text" },
  role: { label: "Role", format: "text" },
  dateOfBirth: { label: "Date of birth", format: "date", sensitive: true },
  ssnLast4: { label: "SSN last 4", format: "text", sensitive: true },
  email: { label: "Email", format: "text" },
  phone: { label: "Phone", format: "text" },
  mobile: { label: "Mobile", format: "text" },
  addressLine1: { label: "Address line 1", format: "text" },
  addressLine2: { label: "Address line 2", format: "text" },
  city: { label: "City", format: "text" },
  state: { label: "State", format: "text" },
  postalCode: { label: "Postal code", format: "text" },
  country: { label: "Country", format: "text" },
  maritalStatus: { label: "Marital status", format: "text" },
  employmentStatus: { label: "Employment status", format: "text" },
  employer: { label: "Employer", format: "text" },
  occupation: { label: "Occupation", format: "text" },
  relationshipLabel: { label: "Relationship", format: "text" },
  notes: { label: "Notes", format: "text", truncate: 120 },
};

/** CRM household account (`crm_household_accounts`). */
export const CRM_ACCOUNT_FIELD_LABELS: FieldLabels = {
  accountType: { label: "Account type", format: "text" },
  custodian: { label: "Custodian", format: "text" },
  accountNumberLast4: {
    label: "Account number last 4",
    format: "text",
    sensitive: true,
  },
  balance: { label: "Balance", format: "currency" },
  balanceAsOf: { label: "Balance as of", format: "date" },
  notes: { label: "Notes", format: "text", truncate: 120 },
};
