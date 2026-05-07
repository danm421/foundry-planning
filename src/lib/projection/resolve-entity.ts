import type {
  Account,
  BeneficiaryRef,
  Income,
  Expense,
  SavingsRule,
} from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import type { createGrowthSourceResolver } from "./resolve-growth-source";

export type GrowthSourceResolver = ReturnType<typeof createGrowthSourceResolver>;

export interface ResolutionContext {
  resolver: GrowthSourceResolver;
  resolvedInflationRate: number;
  /** Per-account associated data — populated by `loadClientData` on the base path,
   *  empty for scenario-added entities (deferred for v1). */
  beneficiariesByAccountId?: Map<string, BeneficiaryRef[]>;
  policiesByAccount?: Record<string, Account["lifeInsurance"]>;
  ownersByAccountId?: Map<string, AccountOwner[]>;
}

type Numericish = string | number | null | undefined;

function n(v: Numericish): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function nNullable(v: Numericish): number | undefined {
  if (v == null) return undefined;
  return typeof v === "number" ? v : parseFloat(v);
}

type RawAccount = {
  id: string;
  name: string;
  category: Account["category"];
  subType: string;
  value: string | number;
  basis: string | number;
  rothValue?: string | number | null;
  growthSource: string | null;
  growthRate: string | number | null;
  turnoverPct: string | null;
  annualPropertyTax: string | number;
  propertyTaxGrowthRate: string | number;
  rmdEnabled: boolean;
  isDefaultChecking: boolean;
  modelPortfolioId: string | null;
  overridePctOi: string | null;
  overridePctLtCg: string | null;
  overridePctQdiv: string | null;
  overridePctTaxExempt: string | null;
  priorYearEndValue: string | number | null;
  insuredPerson: string | null;
  owners?: AccountOwner[];
  beneficiaries?: BeneficiaryRef[];
  lifeInsurance?: Account["lifeInsurance"];
};

export function resolveAccountFromRaw(
  raw: RawAccount,
  ctx: ResolutionContext,
): Account {
  const { resolver, resolvedInflationRate } = ctx;
  const gs = raw.growthSource ?? "default";

  let growthRate: number;
  let realization: Account["realization"];

  let effectiveSource = gs;
  if (effectiveSource === "default") {
    const catSource = resolver.getCategoryGrowthSource(raw.category);
    if (catSource === "asset_mix") effectiveSource = "asset_mix";
  }

  if (effectiveSource === "inflation") {
    growthRate = resolvedInflationRate;
  } else if (effectiveSource === "model_portfolio" && raw.modelPortfolioId) {
    const p = resolver.resolvePortfolio(raw.modelPortfolioId);
    growthRate = p.geoReturn;
    realization = {
      pctOrdinaryIncome:
        raw.overridePctOi != null ? parseFloat(raw.overridePctOi) : p.pctOi,
      pctLtCapitalGains:
        raw.overridePctLtCg != null ? parseFloat(raw.overridePctLtCg) : p.pctLtcg,
      pctQualifiedDividends:
        raw.overridePctQdiv != null ? parseFloat(raw.overridePctQdiv) : p.pctQdiv,
      pctTaxExempt:
        raw.overridePctTaxExempt != null ? parseFloat(raw.overridePctTaxExempt) : p.pctTaxEx,
      turnoverPct: parseFloat(raw.turnoverPct ?? "0"),
    };
  } else if (effectiveSource === "asset_mix") {
    const resolved = resolver.resolveAccountMix(raw.id);
    growthRate = resolved.geoReturn;
    realization = {
      pctOrdinaryIncome:
        raw.overridePctOi != null ? parseFloat(raw.overridePctOi) : resolved.pctOi,
      pctLtCapitalGains:
        raw.overridePctLtCg != null ? parseFloat(raw.overridePctLtCg) : resolved.pctLtcg,
      pctQualifiedDividends:
        raw.overridePctQdiv != null ? parseFloat(raw.overridePctQdiv) : resolved.pctQdiv,
      pctTaxExempt:
        raw.overridePctTaxExempt != null ? parseFloat(raw.overridePctTaxExempt) : resolved.pctTaxEx,
      turnoverPct: parseFloat(raw.turnoverPct ?? "0"),
    };
  } else if (effectiveSource === "custom" && raw.growthRate != null) {
    growthRate = n(raw.growthRate);
  } else {
    const catDefault = resolver.resolveCategoryDefault(raw.category);
    growthRate = catDefault.rate;
    realization = catDefault.realization;
  }

  if (raw.category === "cash") {
    realization = {
      pctOrdinaryIncome: 1,
      pctLtCapitalGains: 0,
      pctQualifiedDividends: 0,
      pctTaxExempt: 0,
      turnoverPct: 0,
    };
  }

  if (raw.category === "retirement") {
    realization = undefined;
  }

  if (
    raw.category === "real_estate" ||
    raw.category === "business" ||
    raw.category === "life_insurance"
  ) {
    growthRate =
      raw.growthRate != null
        ? n(raw.growthRate)
        : resolver.resolveCategoryDefault(raw.category).rate;
    realization = undefined;
  }

  return {
    id: raw.id,
    name: raw.name,
    category: raw.category as Account["category"],
    subType: raw.subType,
    value: n(raw.value),
    basis: n(raw.basis),
    rothValue: raw.rothValue != null ? n(raw.rothValue) : 0,
    growthRate,
    rmdEnabled: raw.rmdEnabled,
    priorYearEndValue: nNullable(raw.priorYearEndValue),
    beneficiaries: raw.beneficiaries ?? ctx.beneficiariesByAccountId?.get(raw.id),
    isDefaultChecking: raw.isDefaultChecking,
    realization,
    annualPropertyTax: n(raw.annualPropertyTax),
    propertyTaxGrowthRate: n(raw.propertyTaxGrowthRate),
    insuredPerson: (raw.insuredPerson as Account["insuredPerson"]) ?? undefined,
    lifeInsurance: raw.lifeInsurance ?? ctx.policiesByAccount?.[raw.id],
    owners: raw.owners ?? ctx.ownersByAccountId?.get(raw.id) ?? [],
  };
}

type RawIncome = {
  id: string;
  type: string;
  name: string;
  annualAmount: string | number;
  startYear: number;
  endYear: number;
  growthSource: string | null;
  growthRate: string | number | null;
  owner: string;
  claimingAge?: number | null;
  linkedEntityId?: string | null;
  ownerEntityId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  taxType?: string | null;
  ssBenefitMode?: string | null;
  piaMonthly?: string | number | null;
  claimingAgeMonths?: number | null;
  claimingAgeMode?: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  scheduleOverrides?: Record<number, number>;
};

export function resolveIncomeFromRaw(
  raw: RawIncome,
  ctx: ResolutionContext,
): Income {
  const growthRate =
    raw.growthSource === "inflation" ? ctx.resolvedInflationRate : n(raw.growthRate);
  return {
    id: raw.id,
    type: raw.type as Income["type"],
    name: raw.name,
    annualAmount: n(raw.annualAmount),
    startYear: raw.startYear,
    endYear: raw.endYear,
    growthRate,
    owner: raw.owner as Income["owner"],
    claimingAge: raw.claimingAge ?? undefined,
    linkedEntityId: raw.linkedEntityId ?? undefined,
    ownerEntityId: raw.ownerEntityId ?? undefined,
    cashAccountId: raw.cashAccountId ?? undefined,
    inflationStartYear: raw.inflationStartYear ?? undefined,
    taxType: (raw.taxType as Income["taxType"]) ?? undefined,
    ssBenefitMode: (raw.ssBenefitMode as Income["ssBenefitMode"]) ?? undefined,
    piaMonthly: nNullable(raw.piaMonthly),
    claimingAgeMonths: raw.claimingAgeMonths ?? 0,
    claimingAgeMode: (raw.claimingAgeMode as Income["claimingAgeMode"]) ?? undefined,
    scheduleOverrides: raw.scheduleOverrides,
    startYearRef: raw.startYearRef ?? null,
    endYearRef: raw.endYearRef ?? null,
    growthSource: raw.growthSource ?? null,
  };
}

type RawExpense = {
  id: string;
  type: string;
  name: string;
  annualAmount: string | number;
  startYear: number;
  endYear: number;
  growthSource: string | null;
  growthRate: string | number | null;
  ownerEntityId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  deductionType?: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  scheduleOverrides?: Record<number, number>;
};

export function resolveExpenseFromRaw(
  raw: RawExpense,
  ctx: ResolutionContext,
): Expense {
  const growthRate =
    raw.growthSource === "inflation" ? ctx.resolvedInflationRate : n(raw.growthRate);
  return {
    id: raw.id,
    type: raw.type as Expense["type"],
    name: raw.name,
    annualAmount: n(raw.annualAmount),
    startYear: raw.startYear,
    endYear: raw.endYear,
    growthRate,
    ownerEntityId: raw.ownerEntityId ?? undefined,
    cashAccountId: raw.cashAccountId ?? undefined,
    inflationStartYear: raw.inflationStartYear ?? undefined,
    deductionType: (raw.deductionType as Expense["deductionType"]) ?? undefined,
    scheduleOverrides: raw.scheduleOverrides,
    startYearRef: raw.startYearRef ?? null,
    endYearRef: raw.endYearRef ?? null,
    growthSource: raw.growthSource ?? null,
  };
}

type RawSavingsRule = {
  id: string;
  accountId: string;
  annualAmount: string | number;
  annualPercent: string | number | null;
  isDeductible: boolean;
  applyContributionLimit: boolean;
  contributeMax: boolean;
  startYear: number;
  endYear: number;
  growthSource: string | null;
  growthRate: string | number | null;
  employerMatchPct?: string | number | null;
  employerMatchCap?: string | number | null;
  employerMatchAmount?: string | number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  scheduleOverrides?: Record<number, number>;
};

export function resolveSavingsRuleFromRaw(
  raw: RawSavingsRule,
  ctx: ResolutionContext,
): SavingsRule {
  const growthRate =
    raw.growthSource === "inflation" ? ctx.resolvedInflationRate : n(raw.growthRate);
  return {
    id: raw.id,
    accountId: raw.accountId,
    annualAmount: n(raw.annualAmount),
    annualPercent: raw.annualPercent != null ? n(raw.annualPercent) : null,
    isDeductible: raw.isDeductible,
    applyContributionLimit: raw.applyContributionLimit,
    contributeMax: raw.contributeMax,
    startYear: raw.startYear,
    endYear: raw.endYear,
    growthRate,
    employerMatchPct: nNullable(raw.employerMatchPct),
    employerMatchCap: nNullable(raw.employerMatchCap),
    employerMatchAmount: nNullable(raw.employerMatchAmount),
    scheduleOverrides: raw.scheduleOverrides,
    startYearRef: raw.startYearRef ?? null,
    endYearRef: raw.endYearRef ?? null,
    growthSource: raw.growthSource ?? null,
  };
}
