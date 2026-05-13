// src/lib/tax/state-income/types.ts
import type { BracketTier, FilingStatus } from "@/lib/tax/types";
import type { USPSStateCode } from "@/lib/usps-states";

export type StateFilingStatus = "single" | "joint";

/** Foundry's 4-status enum → state's 2-status enum.
 *  Default: mfj → joint; single/hoh/mfs → single.
 *  State-specific overrides live in filing-status.ts. */
export type FilingStatusMap = Partial<Record<FilingStatus, StateFilingStatus>>;

export type IncomeBaseKind = "federal-agi" | "federal-taxable" | "state-gti";

export interface BracketsByStateStatus {
  single: BracketTier[];
  joint: BracketTier[];
}

export interface StdDeductionRow {
  single: number;
  joint: number;
  add65Single: number;
  add65Joint: number;
  notes?: string;
}

export type ExemptionType = "exemption" | "credit" | "none";

export interface ExemptionRow {
  single: number;
  joint: number;
  dependent: number;
  add65: number;
  type: ExemptionType;
  notes?: string;
}

export interface IncomeBaseRule {
  base: IncomeBaseKind;
  taxFreeInterestAddback: boolean;
  preTaxRetirementSubtract: boolean;
  alimonySubtract: boolean;
  notes?: string;
}

export type SsTreatment =
  | { kind: "exempt" }
  | { kind: "taxed" }
  | {
      kind: "conditional";
      singleAgiThreshold: number | null;
      jointAgiThreshold: number | null;
      ageFullExemption?: number;
      notes: string;
    };

export interface RetirementRule {
  applies: { db: boolean; ira: boolean; k401: boolean; annuity: boolean };
  ageThreshold?: number;
  agiThresholdSingle?: number;
  agiThresholdJoint?: number;
  perFilerCap?: number;
  combinedSsCap?: boolean;
  notes: string;
}

export interface CapGainsRule {
  ltcgExemptPct?: number;   // e.g. AR 0.5, MT 0.3, ND 0.4, WI 0.3
  gainsOnly?: { brackets: BracketTier[] }; // WA: gains-only path
  notes?: string;
}

export interface RecaptureRule {
  apply: (input: {
    stateTaxableIncome: number;
    preCreditTax: number;
    filingStatus: StateFilingStatus;
  }) => { adjustment: number; note: string };
}

export interface StateIncomeTaxRule {
  state: USPSStateCode;
  hasIncomeTax: boolean;
  effectiveYear: number;
  flat: boolean;                       // flat-rate state (single bracket per status)
  brackets: BracketsByStateStatus;
  stdDeduction: StdDeductionRow;
  exemption: ExemptionRow;
  ss: SsTreatment;
  retirement: RetirementRule;
  capGains: CapGainsRule;
  incomeBase: IncomeBaseRule;
  recapture?: RecaptureRule;
  filingStatusMap?: FilingStatusMap;
  citation: string;
}

export interface StateIncomeTaxAddbacks {
  taxFreeInterest: number;
  other: number;
  total: number;
}

export interface StateIncomeTaxSubtractions {
  socialSecurity: number;
  retirementIncome: number;
  capitalGains: number;
  preTaxContrib: number;
  other: number;
  total: number;
}

export interface StateIncomeTaxResult {
  state: USPSStateCode | null;
  year: number;
  hasIncomeTax: boolean;
  incomeBase: IncomeBaseKind;
  startingIncome: number;
  addbacks: StateIncomeTaxAddbacks;
  subtractions: StateIncomeTaxSubtractions;
  stateAGI: number;
  stdDeduction: number;
  personalExemptionDeduction: number;
  exemptionCredits: number;
  stateTaxableIncome: number;
  filingStatusUsed: FilingStatus;
  stateFilingStatusUsed: StateFilingStatus;
  bracketsUsed: BracketTier[];
  preCreditTax: number;
  specialRulesApplied: string[];
  stateTax: number;
  diag: { notes: string[] };
}
