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

/** "exemption" = a deduction from income; "credit" = off the tax bill; "none" = no amount of this kind. */
export type ExemptionType = "exemption" | "credit" | "none";

/**
 * Each component of a row carries its own kind, because a state's components
 * can differ (KY: no personal exemption but a 65+ CREDIT; AZ: a 65+ EXEMPTION
 * beside a dependent CREDIT). A component whose kind is "none" must carry $0 —
 * enforced by __tests__/exemptions-data.test.ts.
 */
export interface ExemptionRow {
  /** Personal amount per filing status; kind given by `type`. */
  single: number;
  joint: number;
  /** Per-dependent amount. NOT read by the engine yet; give it its own kind when wired up. */
  dependent: number;
  /** Per-filer 65+ add-on; kind given by `add65Type`, falling back to `type`. */
  add65: number;
  type: ExemptionType;
  /** Hand-added column — the workbook generator does not emit it yet. */
  add65Type?: ExemptionType;
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

export interface Plan529Rule {
  /** none = state offers no 529 tax benefit (or has no income tax). */
  kind: "none" | "deduction" | "credit";
  /** Cap basis. per_taxpayer: caps apply to the filer's total contributions.
   *  per_beneficiary: caps apply per designated beneficiary.
   *  unlimited: fully deductible, no cap. */
  basis?: "per_taxpayer" | "per_beneficiary" | "unlimited";
  capSingle?: number;      // annual deduction cap, single filer
  capJoint?: number;       // annual deduction cap, MFJ
  creditRate?: number;     // credit kind: rate applied to capped contributions
  creditMaxSingle?: number; // credit kind: max credit dollars, single
  creditMaxJoint?: number;  // credit kind: max credit dollars, MFJ
  notes: string;
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
