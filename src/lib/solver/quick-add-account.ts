// src/lib/solver/quick-add-account.ts
//
// Pure helpers for the Solver "quick-add account + savings" form. No DB, no
// engine — just maps a small form payload onto engine Account + SavingsRule.

import type { Account, SavingsRule } from "@/engine/types";
import { EDUCATION_529_SENTINEL_OWNER_ID } from "@/engine/ownership";
import { DEDUCTIBLE_ELIGIBLE_SUBTYPES } from "@/lib/tax/derive-deductions";

export type QuickAddType = "taxable" | "ira" | "roth_ira" | "cash";

interface TypeMapping {
  category: Account["category"];
  subType: string;
  isDeductible: boolean;
  rmdEnabled: boolean;
  rothPercent: number | null;
  label: string;
}

export const QUICK_ADD_TYPE_MAP: Record<QuickAddType, TypeMapping> = {
  taxable:  { category: "taxable",    subType: "brokerage", isDeductible: false, rmdEnabled: false, rothPercent: null, label: "Taxable" },
  ira:      { category: "retirement", subType: "ira",       isDeductible: true,  rmdEnabled: true,  rothPercent: null, label: "IRA" },
  roth_ira: { category: "retirement", subType: "roth_ira",  isDeductible: false, rmdEnabled: false, rothPercent: 1,    label: "Roth IRA" },
  cash:     { category: "cash",       subType: "checking",  isDeductible: false, rmdEnabled: false, rothPercent: null, label: "Cash" },
};

export function defaultAccountName(ownerLabel: string, type: QuickAddType): string {
  return `${ownerLabel} — ${QUICK_ADD_TYPE_MAP[type].label}`;
}

export interface QuickAddArgs {
  type: QuickAddType;
  ownerFamilyMemberId: string;
  ownerLabel: string;
  /** Optional name override; defaults to defaultAccountName(). */
  name?: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  accountId: string;
  ruleId: string;
  activationYear?: number | null;
  activationYearRef?: string | null;
}

export function buildQuickAddAccount(args: QuickAddArgs): { account: Account; rule: SavingsRule } {
  const map = QUICK_ADD_TYPE_MAP[args.type];
  const account: Account = {
    id: args.accountId,
    name: args.name?.trim() || defaultAccountName(args.ownerLabel, args.type),
    category: map.category,
    subType: map.subType,
    value: 0,
    basis: 0,
    growthRate: args.growthRate,
    rmdEnabled: map.rmdEnabled,
    titlingType: "jtwros", // engine ignores titling for solo-owned accounts; field is still required
    owners: [{ kind: "family_member", familyMemberId: args.ownerFamilyMemberId, percent: 1 }],
    activationYear: args.activationYear ?? null,
    activationYearRef: args.activationYearRef ?? null,
  };
  const rule: SavingsRule = {
    id: args.ruleId,
    accountId: args.accountId,
    annualAmount: args.annualAmount,
    isDeductible: map.isDeductible,
    startYear: args.startYear,
    endYear: args.endYear,
    ...(map.rothPercent !== null ? { rothPercent: map.rothPercent } : {}),
  };
  return { account, rule };
}

export interface AdditionalSavingsArgs {
  ownerFamilyMemberId: string;
  startYear: number;
  endYear: number;
  growthRate: number;
  accountId: string;
  ruleId: string;
  /** When the savings are invested in a model portfolio, the resolved tax
   *  realization (mirrors resolve-entity's model-portfolio account path). */
  realization?: Account["realization"];
}

/**
 * Builds the real, savable taxable account used by the "minimum additional
 * savings" goal-seek. The paired rule sets fundFromExpenseReduction so the
 * solver models "save more by spending less" — the same semantics as the
 * Retirement Analysis min-savings column, but on a persistable account.
 */
export function buildAdditionalSavingsAccount(args: AdditionalSavingsArgs): { account: Account; rule: SavingsRule } {
  const account: Account = {
    id: args.accountId,
    name: "Additional Savings",
    category: "taxable",
    subType: "brokerage",
    value: 0,
    basis: 0,
    growthRate: args.growthRate,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: args.ownerFamilyMemberId, percent: 1 }],
    ...(args.realization ? { realization: args.realization } : {}),
  };
  const rule: SavingsRule = {
    id: args.ruleId,
    accountId: args.accountId,
    annualAmount: 0,
    isDeductible: false,
    startYear: args.startYear,
    endYear: args.endYear,
    fundFromExpenseReduction: true,
  };
  return { account, rule };
}

/**
 * True when a contribution to this account defaults to above-the-line
 * deductible (pre-tax). Mirrors the engine's gate in derive-deductions:
 * retirement category AND a deduction-eligible subtype, with "other" left
 * unchecked because deductibility there depends on advisor assertion.
 */
export function deductibleForSubType(category: string, subType: string): boolean {
  if (category !== "retirement") return false;
  if (!DEDUCTIBLE_ELIGIBLE_SUBTYPES.has(subType)) return false; // roth_ira, 529, brokerage…
  if (subType === "other") return false;
  return true; // traditional_ira, 401k, 403b
}

export interface ExistingAccountRuleArgs {
  account: { id: string; category: string; subType: string };
  annualAmount: number;
  startYear: number;
  endYear: number;
  ruleId: string;
}

/**
 * Builds a SavingsRule for an account that already exists on the balance
 * sheet (no account-upsert needed — the account is unchanged). Deductibility
 * and Roth designation are derived from the account's category/subType; the
 * Roth split for 401(k)/403(b) is left to the row's RothSplitControl. Rule
 * growth is intentionally unset so the engine inherits the account's growth.
 */
export function buildSavingsRuleForAccount(args: ExistingAccountRuleArgs): SavingsRule {
  const { account } = args;
  const rule: SavingsRule = {
    id: args.ruleId,
    accountId: account.id,
    annualAmount: args.annualAmount,
    isDeductible: deductibleForSubType(account.category, account.subType),
    startYear: args.startYear,
    endYear: args.endYear,
  };
  if (account.subType === "roth_ira") rule.rothPercent = 1;
  return rule;
}

export interface QuickAdd529Args {
  accountId: string;
  ruleId: string;
  /** Fully composed account name (e.g. "Ava — 529 Plan"). */
  name: string;
  /** The education goal's "For" person; a 529 legally needs a beneficiary. */
  beneficiaryFamilyMemberId: string;
  /** Starting balance (value == basis; a 529 is a cash-basis savings vehicle). */
  balance: number;
  /** Annual contribution. <= 0 → no savings rule is created. */
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
}

/**
 * Builds a new 529 (education_savings) account + optional contribution rule for
 * the Solver's inline "add a 529 while adding an education goal" flow. The
 * account mirrors what the loader (resolve-entity) produces for a persisted
 * 529: the single external_beneficiary SENTINEL owner (529s carry no
 * family_member owners) with the real grantor/beneficiary in the education529
 * block. Contributions are never federally deductible.
 */
export function buildQuickAdd529(args: QuickAdd529Args): { account: Account; rule: SavingsRule | null } {
  const account: Account = {
    id: args.accountId,
    name: args.name.trim() || "529 Plan",
    category: "education_savings",
    subType: "529",
    value: args.balance,
    basis: args.balance,
    growthRate: args.growthRate,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [
      { kind: "external_beneficiary", externalBeneficiaryId: EDUCATION_529_SENTINEL_OWNER_ID, percent: 1 },
    ],
    education529: {
      grantorFamilyMemberId: null,
      grantorName: null,
      beneficiaryFamilyMemberId: args.beneficiaryFamilyMemberId,
      beneficiaryName: null,
      rothRolloverEnabled: false,
      rothRolloverStartYear: null,
      rothRolloverAccountId: null,
    },
  };
  const rule: SavingsRule | null =
    args.annualAmount > 0
      ? {
          id: args.ruleId,
          accountId: args.accountId,
          annualAmount: args.annualAmount,
          isDeductible: false,
          startYear: args.startYear,
          endYear: args.endYear,
        }
      : null;
  return { account, rule };
}
