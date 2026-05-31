// src/lib/solver/quick-add-account.ts
//
// Pure helpers for the Solver "quick-add account + savings" form. No DB, no
// engine — just maps a small form payload onto engine Account + SavingsRule.

import type { Account, SavingsRule } from "@/engine/types";

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
    owners: [{ kind: "family_member", familyMemberId: args.ownerFamilyMemberId, percent: 100 }],
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
  ownerLabel: string;
  startYear: number;
  endYear: number;
  growthRate: number;
  accountId: string;
  ruleId: string;
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
    owners: [{ kind: "family_member", familyMemberId: args.ownerFamilyMemberId, percent: 100 }],
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
