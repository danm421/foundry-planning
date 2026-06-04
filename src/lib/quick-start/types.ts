// src/lib/quick-start/types.ts
import type { IndividualOwner } from "@/lib/owner-labels";

/** Owner that can be assigned in the wizard. "joint" allowed for incomes/accounts. */
export type QsOwner = IndividualOwner; // "client" | "spouse" | "joint"

export type QsIncomeKind = "salary" | "pension" | "social_security" | "other";

export interface QsIncomeDraft {
  kind: QsIncomeKind;
  owner: QsOwner;
  /** Annual amount for salary/pension/other; ignored for social_security. */
  amount?: number;
  /** Tax treatment override for salary/other; pension+SS are fixed by kind. */
  taxType?: "earned_income" | "ordinary_income" | "capital_gains" | "tax_exempt";
  /** Concrete years if the advisor overrode the defaults; else derived. */
  startYear?: number;
  endYear?: number;
  /** social_security only: estimated MONTHLY benefit at FRA + whole-year claiming age. */
  monthlyBenefit?: number;
  claimingAge?: number;
}

export type QsAccountKind = "cash" | "taxable" | "retirement" | "real_estate";
export type QsRetirementSubtype = "traditional_ira" | "roth_ira" | "401k" | "403b";

export interface QsAccountDraft {
  kind: QsAccountKind;
  owner: QsOwner;
  value: number;
  /** taxable + real_estate only; mirrors value when omitted. */
  basis?: number;
  /** retirement only. */
  subType?: QsRetirementSubtype;
}

export interface QsLiabilityDraft {
  name: string;
  balance: number;
  interestRate: number; // as a fraction, e.g. 0.05
  monthlyPayment?: number;
  termYears?: number; // used to compute payment if monthlyPayment omitted
}

export interface QsOtherExpenseDraft {
  name: string;
  amount: number;
  startYear?: number;
  endYear?: number;
}

export type QsContribMode = "fixed" | "percent" | "max";
export type QsMatchMode = "none" | "fixed" | "percent";

export interface QsSavingsDraft {
  accountId: string;
  accountCategory: "cash" | "taxable" | "retirement";
  accountSubType?: string;
  /** retirement only: route to Roth side of a 401k/403b. */
  roth?: boolean;
  mode: QsContribMode; // cash/taxable always "fixed"
  amount?: number; // for fixed
  percent?: number; // for percent (fraction of salary)
  growthInflation?: boolean; // cash/taxable
  matchMode?: QsMatchMode; // workplace only
  matchPercent?: number; // fraction of salary
  matchCap?: number; // fraction of salary
  matchAmount?: number; // fixed $
  startYear?: number;
  endYear?: number;
}

export type QsPolicyType = "term" | "whole" | "universal";

export interface QsInsuranceDraft {
  insured: "client" | "spouse";
  policyType: QsPolicyType;
  faceValue: number;
  premiumAmount: number;
  /** term only. */
  termLengthYears?: number;
  /** premium duration: a number of years, or "until retirement". */
  premiumYears?: number;
  endsAtInsuredRetirement?: boolean;
  termIssueYear?: number; // term only; defaults to plan start year
}

export type QsTaxMode = "brackets" | "flat";

export interface QsAssumptionsDraft {
  taxMode: QsTaxMode;
  flatFederalRate?: number; // fraction, flat mode
  flatStateRate?: number; // fraction, flat mode
  inflationRate: number; // fraction
  growthTaxable: number;
  growthCash: number;
  growthRetirement: number;
  growthRealEstate: number;
  growthLifeInsurance: number;
}
