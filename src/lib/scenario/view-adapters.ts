// src/lib/scenario/view-adapters.ts
//
// Engine → view shape adapters. The engine returns numeric / typed values
// (Income.annualAmount: number); legacy view components consume stringified
// shapes (View.Income.annualAmount: string). These adapters bridge the gap
// so pages can wire reads through `loadEffectiveTree` instead of querying
// base rows directly.
//
// Adapter layer is deliberately thin — most fields are pure pass-through or
// numeric→string coercion. When the views eventually consume engine types
// directly, these adapters become identity functions and delete cleanly.
//
// IMPORTANT: when an engine entity is missing a view-only field (e.g. an
// Account needs `modelPortfolioId` for the form's portfolio dropdown but
// the engine type doesn't carry it), the adapter returns a partial and the
// page is responsible for merging in those extras from a parallel base-row
// query. Those extras are not scenario-changeable today.

import type {
  Account as EngineAccount,
  ClientInfo,
  Expense as EngineExpense,
  Income as EngineIncome,
  Liability as EngineLiability,
  PlanSettings as EnginePlanSettings,
  SavingsRule as EngineSavingsRule,
  EntitySummary,
} from "@/engine/types";
import { controllingEntity } from "@/engine/ownership";

// ── Income ────────────────────────────────────────────────────────────────────

export interface IncomeView {
  id: string;
  type: EngineIncome["type"];
  name: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  owner: EngineIncome["owner"];
  claimingAge: number | null;
  claimingAgeMonths?: number | null;
  growthRate: string;
  growthSource?: string | null;
  ownerEntityId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  taxType?: string | null;
  ssBenefitMode?: string | null;
  piaMonthly?: string | null;
}

export function incomeEngineToView(income: EngineIncome): IncomeView {
  return {
    id: income.id,
    type: income.type,
    name: income.name,
    annualAmount: String(income.annualAmount),
    startYear: income.startYear,
    endYear: income.endYear,
    owner: income.owner,
    claimingAge: income.claimingAge ?? null,
    claimingAgeMonths: income.claimingAgeMonths ?? null,
    growthRate: String(income.growthRate),
    growthSource: income.growthSource ?? null,
    ownerEntityId: income.ownerEntityId ?? null,
    cashAccountId: income.cashAccountId ?? null,
    inflationStartYear: income.inflationStartYear ?? null,
    startYearRef: income.startYearRef ?? null,
    endYearRef: income.endYearRef ?? null,
    taxType: income.taxType ?? null,
    ssBenefitMode: income.ssBenefitMode ?? null,
    piaMonthly: income.piaMonthly != null ? String(income.piaMonthly) : null,
  };
}

// ── Expense ───────────────────────────────────────────────────────────────────

export interface ExpenseView {
  id: string;
  type: EngineExpense["type"];
  name: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  growthRate: string;
  growthSource?: string | null;
  ownerEntityId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  deductionType?: string | null;
  isDefault?: boolean;
}

export function expenseEngineToView(expense: EngineExpense): ExpenseView {
  return {
    id: expense.id,
    type: expense.type,
    name: expense.name,
    annualAmount: String(expense.annualAmount),
    startYear: expense.startYear,
    endYear: expense.endYear,
    growthRate: String(expense.growthRate),
    growthSource: expense.growthSource ?? null,
    ownerEntityId: expense.ownerEntityId ?? null,
    cashAccountId: expense.cashAccountId ?? null,
    inflationStartYear: expense.inflationStartYear ?? null,
    startYearRef: expense.startYearRef ?? null,
    endYearRef: expense.endYearRef ?? null,
    deductionType: expense.deductionType ?? null,
    isDefault: expense.isDefault ?? false,
  };
}

// ── SavingsRule ───────────────────────────────────────────────────────────────

export interface SavingsRuleView {
  id: string;
  accountId: string;
  annualAmount: string;
  annualPercent?: string | null;
  isDeductible?: boolean;
  applyContributionLimit?: boolean;
  contributeMax?: boolean;
  startYear: number;
  endYear: number;
  growthRate?: string | null;
  growthSource?: string | null;
  employerMatchPct: string | null;
  employerMatchCap: string | null;
  employerMatchAmount: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
}

export function savingsRuleEngineToView(rule: EngineSavingsRule): SavingsRuleView {
  return {
    id: rule.id,
    accountId: rule.accountId,
    annualAmount: String(rule.annualAmount),
    annualPercent: rule.annualPercent != null ? String(rule.annualPercent) : null,
    isDeductible: rule.isDeductible,
    applyContributionLimit: rule.applyContributionLimit,
    contributeMax: rule.contributeMax,
    startYear: rule.startYear,
    endYear: rule.endYear,
    growthRate: rule.growthRate != null ? String(rule.growthRate) : null,
    growthSource: rule.growthSource ?? null,
    employerMatchPct: rule.employerMatchPct != null ? String(rule.employerMatchPct) : null,
    employerMatchCap: rule.employerMatchCap != null ? String(rule.employerMatchCap) : null,
    employerMatchAmount: rule.employerMatchAmount != null ? String(rule.employerMatchAmount) : null,
    startYearRef: rule.startYearRef ?? null,
    endYearRef: rule.endYearRef ?? null,
  };
}

// ── Account ───────────────────────────────────────────────────────────────────

/**
 * Engine fields only. Pages must merge in non-engine fields (modelPortfolioId,
 * turnoverPct, overridePct*, growthSource) from a parallel base-row query.
 */
export interface AccountViewEngineFields {
  id: string;
  name: string;
  category: EngineAccount["category"];
  subType: string;
  value: string;
  basis: string;
  rothValue: string;
  growthRate: string | null;
  rmdEnabled: boolean | null;
  ownerEntityId: string | null;
  isDefaultChecking: boolean;
}

export function accountEngineToView(account: EngineAccount): AccountViewEngineFields {
  return {
    id: account.id,
    name: account.name,
    category: account.category,
    subType: account.subType,
    value: String(account.value),
    basis: String(account.basis),
    rothValue: String(account.rothValue ?? 0),
    growthRate: account.growthRate != null ? String(account.growthRate) : null,
    rmdEnabled: account.rmdEnabled ?? null,
    ownerEntityId: controllingEntity(account) ?? null,
    isDefaultChecking: account.isDefaultChecking ?? false,
  };
}

// ── Liability ─────────────────────────────────────────────────────────────────

/**
 * Engine fields only. Pages must merge in `termUnit` from a parallel
 * base-row query (engine doesn't carry the display preference).
 */
export interface LiabilityViewEngineFields {
  id: string;
  name: string;
  balance: string;
  interestRate: string;
  monthlyPayment: string;
  startYear: number;
  startMonth: number;
  termMonths: number;
  balanceAsOfMonth: number | null;
  balanceAsOfYear: number | null;
  linkedPropertyId: string | null;
  ownerEntityId: string | null;
  isInterestDeductible: boolean;
}

export function liabilityEngineToView(liability: EngineLiability): LiabilityViewEngineFields {
  return {
    id: liability.id,
    name: liability.name,
    balance: String(liability.balance),
    interestRate: String(liability.interestRate),
    monthlyPayment: String(liability.monthlyPayment),
    startYear: liability.startYear,
    startMonth: liability.startMonth,
    termMonths: liability.termMonths,
    balanceAsOfMonth: liability.balanceAsOfMonth ?? null,
    balanceAsOfYear: liability.balanceAsOfYear ?? null,
    linkedPropertyId: liability.linkedPropertyId ?? null,
    ownerEntityId: controllingEntity(liability) ?? null,
    isInterestDeductible: liability.isInterestDeductible ?? false,
  };
}

// ── Entity ────────────────────────────────────────────────────────────────────

/**
 * Engine fields only. Pages must merge in `name`, `value`, `owner`, `notes`
 * from a parallel base-row query (engine `EntitySummary` is intentionally
 * narrower than the DB row).
 */
export interface EntityViewEngineFields {
  id: string;
  includeInPortfolio: boolean;
  isGrantor: boolean;
  trustSubType: string | null;
  isIrrevocable: boolean | null;
  trustee: string | null;
  exemptionConsumed: string;
  grantor: "client" | "spouse" | null;
  entityType: string | null;
  distributionMode: "fixed" | "pct_liquid" | "pct_income" | null;
  distributionAmount: number | null;
  distributionPercent: number | null;
}

export function entityEngineToView(entity: EntitySummary): EntityViewEngineFields {
  return {
    id: entity.id,
    includeInPortfolio: entity.includeInPortfolio,
    isGrantor: entity.isGrantor,
    trustSubType: entity.trustSubType ?? null,
    isIrrevocable: entity.isIrrevocable ?? null,
    trustee: entity.trustee ?? null,
    exemptionConsumed: String(entity.exemptionConsumed ?? 0),
    grantor: entity.grantor ?? null,
    entityType: entity.entityType ?? null,
    distributionMode: entity.distributionMode ?? null,
    distributionAmount: entity.distributionAmount ?? null,
    distributionPercent: entity.distributionPercent ?? null,
  };
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface ClientView {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  retirementMonth: number;
  planEndAge: number;
  lifeExpectancy: number | null;
  spouseName: string | null;
  spouseDob: string | null;
  spouseRetirementAge: number | null;
  spouseRetirementMonth: number | null;
  spouseLifeExpectancy: number | null;
  filingStatus: ClientInfo["filingStatus"];
}

export function clientEngineToView(client: ClientInfo): ClientView {
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    dateOfBirth: client.dateOfBirth,
    retirementAge: client.retirementAge,
    retirementMonth: client.retirementMonth ?? 1,
    planEndAge: client.planEndAge,
    lifeExpectancy: client.lifeExpectancy ?? null,
    spouseName: client.spouseName ?? null,
    spouseDob: client.spouseDob ?? null,
    spouseRetirementAge: client.spouseRetirementAge ?? null,
    spouseRetirementMonth: client.spouseRetirementMonth ?? null,
    spouseLifeExpectancy: client.spouseLifeExpectancy ?? null,
    filingStatus: client.filingStatus,
  };
}

// ── PlanSettings ──────────────────────────────────────────────────────────────

/**
 * Engine fields only. The DB plan_settings row carries many additional fields
 * (defaultGrowth*, modelPortfolioId*, growthSource*, useCustomCma, etc.) used
 * only for category-default UI on the assumptions/balance-sheet pages — those
 * are pulled separately from a base-row query.
 */
export interface PlanSettingsViewEngineFields {
  flatFederalRate: string;
  flatStateRate: string;
  inflationRate: string;
  planStartYear: number;
  planEndYear: number;
  taxEngineMode: EnginePlanSettings["taxEngineMode"];
  taxInflationRate: string | null;
  ssWageGrowthRate: string | null;
  estateAdminExpenses: string;
  flatStateEstateRate: string;
  irdTaxRate: string;
  outOfHouseholdRate: string | null;
}

export function planSettingsEngineToView(s: EnginePlanSettings): PlanSettingsViewEngineFields {
  return {
    flatFederalRate: String(s.flatFederalRate),
    flatStateRate: String(s.flatStateRate),
    inflationRate: String(s.inflationRate),
    planStartYear: s.planStartYear,
    planEndYear: s.planEndYear,
    taxEngineMode: s.taxEngineMode,
    taxInflationRate: s.taxInflationRate != null ? String(s.taxInflationRate) : null,
    ssWageGrowthRate: s.ssWageGrowthRate != null ? String(s.ssWageGrowthRate) : null,
    estateAdminExpenses: String(s.estateAdminExpenses ?? 0),
    flatStateEstateRate: String(s.flatStateEstateRate ?? 0),
    irdTaxRate: String(s.irdTaxRate ?? 0),
    outOfHouseholdRate: s.outOfHouseholdRate != null ? String(s.outOfHouseholdRate) : null,
  };
}
