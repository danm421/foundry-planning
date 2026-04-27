/**
 * Load a client's projection-data (mirroring the GET route) directly from the
 * DB, run the projection engine, and surface NaN / diagnostic hits.
 *
 * Usage: npx tsx scripts/audit-cashflow.ts <client-uuid>
 *
 * Bypasses auth so it can be run outside a request context. Meant for
 * debugging & regression-checking; not for production.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Load .env.local without a runtime dep
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch {}
import { eq, and, asc, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  clients,
  scenarios,
  accounts,
  incomes,
  expenses,
  liabilities,
  extraPayments,
  savingsRules,
  withdrawalStrategies,
  planSettings,
  entities,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  taxYearParameters,
  clientDeductions,
  accountAssetAllocations,
  incomeScheduleOverrides,
  expenseScheduleOverrides,
  savingsScheduleOverrides,
  transfers,
  transferSchedules,
  assetTransactions,
  clientCmaOverrides,
} from "../src/db/schema";
import { dbRowToTaxYearParameters } from "../src/lib/tax/dbMapper";
import { resolveInflationRate } from "../src/lib/inflation";
import { runProjection } from "../src/engine/projection";
import type { ClientData } from "../src/engine/types";

async function loadClientData(clientId: string): Promise<ClientData> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new Error(`Client ${clientId} not found`);

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) throw new Error("No base case scenario");

  const [
    accountRows,
    incomeRows,
    expenseRows,
    liabilityRows,
    savingsRuleRows,
    withdrawalRows,
    planSettingsRows,
    entityRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    extraPaymentRows,
    transferRows,
    transferScheduleRows,
    assetTransactionRows,
  ] = await Promise.all([
    db.select().from(accounts).where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id))),
    db.select().from(incomes).where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenario.id))),
    db.select().from(expenses).where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenario.id))),
    db.select().from(liabilities).where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenario.id))),
    db.select().from(savingsRules).where(and(eq(savingsRules.clientId, clientId), eq(savingsRules.scenarioId, scenario.id))),
    db.select().from(withdrawalStrategies).where(and(eq(withdrawalStrategies.clientId, clientId), eq(withdrawalStrategies.scenarioId, scenario.id))),
    db.select().from(planSettings).where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, clientId)),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, client.firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, client.firmId)),
    db.select().from(extraPayments),
    db.select().from(transfers).where(and(eq(transfers.clientId, clientId), eq(transfers.scenarioId, scenario.id))),
    db.select().from(transferSchedules),
    db.select().from(assetTransactions).where(and(eq(assetTransactions.clientId, clientId), eq(assetTransactions.scenarioId, scenario.id))),
  ]);

  const incomeIds = incomeRows.map((i) => i.id);
  const expenseIds = expenseRows.map((e) => e.id);
  const savingsRuleIds = savingsRuleRows.map((s) => s.id);

  const [incomeOverrideRows, expenseOverrideRows, savingsOverrideRows] = await Promise.all([
    incomeIds.length > 0
      ? db.select().from(incomeScheduleOverrides).where(inArray(incomeScheduleOverrides.incomeId, incomeIds))
      : Promise.resolve([]),
    expenseIds.length > 0
      ? db.select().from(expenseScheduleOverrides).where(inArray(expenseScheduleOverrides.expenseId, expenseIds))
      : Promise.resolve([]),
    savingsRuleIds.length > 0
      ? db.select().from(savingsScheduleOverrides).where(inArray(savingsScheduleOverrides.savingsRuleId, savingsRuleIds))
      : Promise.resolve([]),
  ]);

  const incomeOverrideMap = new Map<string, Map<number, number>>();
  for (const row of incomeOverrideRows) {
    if (!incomeOverrideMap.has(row.incomeId)) incomeOverrideMap.set(row.incomeId, new Map());
    incomeOverrideMap.get(row.incomeId)!.set(row.year, parseFloat(row.amount));
  }
  const expenseOverrideMap = new Map<string, Map<number, number>>();
  for (const row of expenseOverrideRows) {
    if (!expenseOverrideMap.has(row.expenseId)) expenseOverrideMap.set(row.expenseId, new Map());
    expenseOverrideMap.get(row.expenseId)!.set(row.year, parseFloat(row.amount));
  }
  const savingsOverrideMap = new Map<string, Map<number, number>>();
  for (const row of savingsOverrideRows) {
    if (!savingsOverrideMap.has(row.savingsRuleId)) savingsOverrideMap.set(row.savingsRuleId, new Map());
    savingsOverrideMap.get(row.savingsRuleId)!.set(row.year, parseFloat(row.amount));
  }

  const [settings] = planSettingsRows;
  if (!settings) throw new Error("No plan settings");

  const taxYearRowsRaw = await db.select().from(taxYearParameters).orderBy(asc(taxYearParameters.year));
  const parsedTaxRows = taxYearRowsRaw.map(dbRowToTaxYearParameters);

  const deductionRows = await db.select().from(clientDeductions).where(and(eq(clientDeductions.clientId, clientId), eq(clientDeductions.scenarioId, scenario.id)));
  const parsedDeductions = deductionRows.map((d) => ({
    type: d.type,
    annualAmount: parseFloat(d.annualAmount),
    growthRate: parseFloat(d.growthRate),
    startYear: d.startYear,
    endYear: d.endYear,
  }));

  let accountAllocRows: (typeof accountAssetAllocations.$inferSelect)[] = [];
  if (accountRows.length > 0) {
    accountAllocRows = await db
      .select()
      .from(accountAssetAllocations)
      .where(inArray(accountAssetAllocations.accountId, accountRows.map((a) => a.id)));
  }
  const allocsByAccount = new Map<string, typeof accountAllocRows>();
  for (const row of accountAllocRows) {
    const list = allocsByAccount.get(row.accountId) ?? [];
    list.push(row);
    allocsByAccount.set(row.accountId, list);
  }

  const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
  const inflationClass = assetClassRows.find((ac) => ac.slug === "inflation");
  const inflationFallback = inflationClass
    ? {
        geoReturn: parseFloat(inflationClass.geometricReturn),
        pctOi: parseFloat(inflationClass.pctOrdinaryIncome),
        pctLtcg: parseFloat(inflationClass.pctLtCapitalGains),
        pctQdiv: parseFloat(inflationClass.pctQualifiedDividends),
        pctTaxEx: parseFloat(inflationClass.pctTaxExempt),
      }
    : { geoReturn: 0.025, pctOi: 1, pctLtcg: 0, pctQdiv: 0, pctTaxEx: 0 };

  const allocsByPortfolio = new Map<string, typeof allocationRows>();
  for (const alloc of allocationRows) {
    const list = allocsByPortfolio.get(alloc.modelPortfolioId) ?? [];
    list.push(alloc);
    allocsByPortfolio.set(alloc.modelPortfolioId, list);
  }

  function resolvePortfolio(portfolioId: string) {
    const allocs = allocsByPortfolio.get(portfolioId) ?? [];
    let geoReturn = 0, pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (!ac) continue;
      const w = parseFloat(alloc.weight);
      geoReturn += w * parseFloat(ac.geometricReturn);
      pctOi += w * parseFloat(ac.pctOrdinaryIncome);
      pctLtcg += w * parseFloat(ac.pctLtCapitalGains);
      pctQdiv += w * parseFloat(ac.pctQualifiedDividends);
      pctTaxEx += w * parseFloat(ac.pctTaxExempt);
    }
    return { geoReturn, pctOi, pctLtcg, pctQdiv, pctTaxEx };
  }

  function resolveAccountAllocations(accountId: string) {
    const allocs = allocsByAccount.get(accountId) ?? [];
    let totalWeight = 0, geoReturn = 0, pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (!ac) continue;
      const w = parseFloat(alloc.weight);
      totalWeight += w;
      geoReturn += w * parseFloat(ac.geometricReturn);
      pctOi += w * parseFloat(ac.pctOrdinaryIncome);
      pctLtcg += w * parseFloat(ac.pctLtCapitalGains);
      pctQdiv += w * parseFloat(ac.pctQualifiedDividends);
      pctTaxEx += w * parseFloat(ac.pctTaxExempt);
    }
    const unclassified = Math.max(0, 1 - totalWeight);
    if (unclassified > 0) {
      geoReturn += unclassified * inflationFallback.geoReturn;
      pctOi += unclassified * inflationFallback.pctOi;
      pctLtcg += unclassified * inflationFallback.pctLtcg;
      pctQdiv += unclassified * inflationFallback.pctQdiv;
      pctTaxEx += unclassified * inflationFallback.pctTaxEx;
    }
    return { geoReturn, pctOi, pctLtcg, pctQdiv, pctTaxEx };
  }

  function resolveCategoryDefault(category: string) {
    const sourceLookup: Record<string, { source: string; portfolioId: string | null; customRate: string }> = {
      taxable: { source: settings.growthSourceTaxable, portfolioId: settings.modelPortfolioIdTaxable, customRate: String(settings.defaultGrowthTaxable) },
      cash: { source: settings.growthSourceCash, portfolioId: settings.modelPortfolioIdCash, customRate: String(settings.defaultGrowthCash) },
      retirement: { source: settings.growthSourceRetirement, portfolioId: settings.modelPortfolioIdRetirement, customRate: String(settings.defaultGrowthRetirement) },
    };
    const entry = sourceLookup[category];
    if (!entry) {
      const flatDefaults: Record<string, string> = {
        real_estate: String(settings.defaultGrowthRealEstate),
        business: String(settings.defaultGrowthBusiness),
        life_insurance: String(settings.defaultGrowthLifeInsurance),
      };
      return { rate: parseFloat(flatDefaults[category] ?? "0.05"), realization: undefined as any };
    }
    if (entry.source === "model_portfolio" && entry.portfolioId) {
      const p = resolvePortfolio(entry.portfolioId);
      return { rate: p.geoReturn, realization: { pctOrdinaryIncome: p.pctOi, pctLtCapitalGains: p.pctLtcg, pctQualifiedDividends: p.pctQdiv, pctTaxExempt: p.pctTaxEx, turnoverPct: 0 } };
    }
    return { rate: parseFloat(entry.customRate), realization: undefined as any };
  }

  function getCategoryGrowthSource(category: string): string {
    const m: Record<string, string> = { taxable: settings.growthSourceTaxable, cash: settings.growthSourceCash, retirement: settings.growthSourceRetirement };
    return m[category] ?? "custom";
  }

  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings.useCustomCma && inflationClass) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(eq(clientCmaOverrides.clientId, clientId), eq(clientCmaOverrides.sourceAssetClassId, inflationClass.id)));
    if (override) clientInflationOverride = override;
  }

  const resolvedInflationRate = resolveInflationRate(
    { inflationRateSource: settings.inflationRateSource, inflationRate: settings.inflationRate },
    inflationClass ? { geometricReturn: inflationClass.geometricReturn } : null,
    clientInflationOverride,
  );

  const data: ClientData = {
    client: {
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: client.dateOfBirth,
      retirementAge: client.retirementAge,
      planEndAge: client.planEndAge,
      lifeExpectancy: client.lifeExpectancy,
      spouseName: client.spouseName ?? undefined,
      spouseDob: client.spouseDob ?? undefined,
      spouseRetirementAge: client.spouseRetirementAge ?? undefined,
      spouseLifeExpectancy: client.spouseLifeExpectancy ?? null,
      filingStatus: client.filingStatus,
    } as any,
    accounts: accountRows.map((a) => {
      let growthRate: number;
      let realization: any = undefined;
      const gs = a.growthSource ?? "default";
      let effectiveSource = gs;
      if (effectiveSource === "default") {
        const catSource = getCategoryGrowthSource(a.category);
        if (catSource === "asset_mix") effectiveSource = "asset_mix";
      }
      if (effectiveSource === "inflation") {
        growthRate = resolvedInflationRate;
      } else if (effectiveSource === "model_portfolio" && a.modelPortfolioId) {
        const p = resolvePortfolio(a.modelPortfolioId);
        growthRate = p.geoReturn;
        realization = { pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : p.pctOi, pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : p.pctLtcg, pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : p.pctQdiv, pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : p.pctTaxEx, turnoverPct: parseFloat(a.turnoverPct ?? "0") };
      } else if (effectiveSource === "asset_mix") {
        const r = resolveAccountAllocations(a.id);
        growthRate = r.geoReturn;
        realization = { pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : r.pctOi, pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : r.pctLtcg, pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : r.pctQdiv, pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : r.pctTaxEx, turnoverPct: parseFloat(a.turnoverPct ?? "0") };
      } else if (effectiveSource === "custom" && a.growthRate != null) {
        growthRate = parseFloat(a.growthRate);
      } else {
        const cd = resolveCategoryDefault(a.category);
        growthRate = cd.rate;
        realization = cd.realization;
      }
      if (a.category === "cash") realization = { pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, turnoverPct: 0 };
      if (a.category === "retirement") realization = undefined;
      if (["real_estate", "business", "life_insurance"].includes(a.category)) {
        const fd: Record<string, string> = { real_estate: String(settings.defaultGrowthRealEstate), business: String(settings.defaultGrowthBusiness), life_insurance: String(settings.defaultGrowthLifeInsurance) };
        growthRate = a.growthRate != null ? parseFloat(a.growthRate) : parseFloat(fd[a.category] ?? "0.04");
        realization = undefined;
      }
      return {
        id: a.id, name: a.name, category: a.category, subType: a.subType,
        value: parseFloat(a.value), basis: parseFloat(a.basis), growthRate,
        rmdEnabled: a.rmdEnabled,
        isDefaultChecking: a.isDefaultChecking, realization,
        annualPropertyTax: parseFloat(a.annualPropertyTax),
        propertyTaxGrowthRate: parseFloat(a.propertyTaxGrowthRate),
      } as any;
    }),
    incomes: incomeRows.map((i) => ({
      id: i.id, type: i.type, name: i.name, annualAmount: parseFloat(i.annualAmount),
      startYear: i.startYear, endYear: i.endYear,
      growthRate: i.growthSource === "inflation" ? resolvedInflationRate : parseFloat(i.growthRate),
      owner: i.owner, claimingAge: i.claimingAge ?? undefined,
      linkedEntityId: i.linkedEntityId ?? undefined, ownerEntityId: i.ownerEntityId ?? undefined,
      cashAccountId: i.cashAccountId ?? undefined, inflationStartYear: i.inflationStartYear ?? undefined,
      taxType: i.taxType ?? undefined, ssBenefitMode: i.ssBenefitMode ?? undefined,
      piaMonthly: i.piaMonthly != null ? parseFloat(i.piaMonthly) : undefined,
      claimingAgeMonths: i.claimingAgeMonths ?? 0,
      claimingAgeMode: (i.claimingAgeMode as any) ?? undefined,
      scheduleOverrides: incomeOverrideMap.get(i.id),
    })) as any,
    expenses: expenseRows.map((e) => ({
      id: e.id, type: e.type, name: e.name, annualAmount: parseFloat(e.annualAmount),
      startYear: e.startYear, endYear: e.endYear,
      growthRate: e.growthSource === "inflation" ? resolvedInflationRate : parseFloat(e.growthRate),
      ownerEntityId: e.ownerEntityId ?? undefined, cashAccountId: e.cashAccountId ?? undefined,
      inflationStartYear: e.inflationStartYear ?? undefined,
      deductionType: e.deductionType ?? undefined, scheduleOverrides: expenseOverrideMap.get(e.id),
    })) as any,
    liabilities: liabilityRows.map((l) => ({
      id: l.id, name: l.name, balance: parseFloat(l.balance),
      interestRate: parseFloat(l.interestRate), monthlyPayment: parseFloat(l.monthlyPayment),
      startYear: l.startYear, startMonth: l.startMonth, termMonths: l.termMonths,
      balanceAsOfMonth: l.balanceAsOfMonth ?? undefined, balanceAsOfYear: l.balanceAsOfYear ?? undefined,
      linkedPropertyId: l.linkedPropertyId ?? undefined,
      isInterestDeductible: l.isInterestDeductible,
      extraPayments: extraPaymentRows.filter((ep) => ep.liabilityId === l.id).map((ep) => ({ id: ep.id, liabilityId: ep.liabilityId, year: ep.year, type: ep.type, amount: parseFloat(ep.amount) })),
    })) as any,
    savingsRules: savingsRuleRows.map((s) => ({
      id: s.id, accountId: s.accountId, annualAmount: parseFloat(s.annualAmount),
      annualPercent: s.annualPercent != null ? parseFloat(s.annualPercent) : null,
      isDeductible: s.isDeductible, applyContributionLimit: s.applyContributionLimit,
      startYear: s.startYear, endYear: s.endYear,
      growthRate: s.growthSource === "inflation" ? resolvedInflationRate : Number(s.growthRate ?? 0),
      employerMatchPct: s.employerMatchPct != null ? parseFloat(s.employerMatchPct) : undefined,
      employerMatchCap: s.employerMatchCap != null ? parseFloat(s.employerMatchCap) : undefined,
      employerMatchAmount: s.employerMatchAmount != null ? parseFloat(s.employerMatchAmount) : undefined,
      scheduleOverrides: savingsOverrideMap.get(s.id),
    })) as any,
    withdrawalStrategy: withdrawalRows.map((w) => ({ accountId: w.accountId, priorityOrder: w.priorityOrder, startYear: w.startYear, endYear: w.endYear })),
    planSettings: {
      flatFederalRate: parseFloat(settings.flatFederalRate),
      flatStateRate: parseFloat(settings.flatStateRate),
      inflationRate: parseFloat(settings.inflationRate),
      planStartYear: settings.planStartYear, planEndYear: settings.planEndYear,
      taxEngineMode: settings.taxEngineMode,
      taxInflationRate: settings.taxInflationRate != null ? parseFloat(settings.taxInflationRate) : null,
      ssWageGrowthRate: settings.ssWageGrowthRate != null ? parseFloat(settings.ssWageGrowthRate) : null,
    } as any,
    entities: entityRows.map((e) => ({ id: e.id, includeInPortfolio: e.includeInPortfolio, isGrantor: e.isGrantor })) as any,
    taxYearRows: parsedTaxRows,
    deductions: parsedDeductions as any,
    transfers: transferRows.map((t) => {
      const schedules = transferScheduleRows.filter((s) => s.transferId === t.id).map((s) => ({ year: s.year, amount: parseFloat(s.amount) }));
      return { id: t.id, name: t.name, sourceAccountId: t.sourceAccountId, targetAccountId: t.targetAccountId, amount: parseFloat(t.amount), mode: t.mode, startYear: t.startYear, endYear: t.endYear ?? undefined, growthRate: parseFloat(t.growthRate), schedules } as any;
    }),
    assetTransactions: assetTransactionRows.map((t) => ({
      id: t.id, name: t.name, type: t.type, year: t.year, accountId: t.accountId ?? undefined,
      overrideSaleValue: t.overrideSaleValue ? parseFloat(t.overrideSaleValue) : undefined,
      overrideBasis: t.overrideBasis ? parseFloat(t.overrideBasis) : undefined,
      transactionCostPct: t.transactionCostPct ? parseFloat(t.transactionCostPct) : undefined,
      transactionCostFlat: t.transactionCostFlat ? parseFloat(t.transactionCostFlat) : undefined,
      proceedsAccountId: t.proceedsAccountId ?? undefined,
      qualifiesForHomeSaleExclusion: t.qualifiesForHomeSaleExclusion,
      assetName: t.assetName ?? undefined, assetCategory: t.assetCategory ?? undefined, assetSubType: t.assetSubType ?? undefined,
      purchasePrice: t.purchasePrice ? parseFloat(t.purchasePrice) : undefined,
      growthRate: t.growthRate ? parseFloat(t.growthRate) : undefined,
      basis: t.basis ? parseFloat(t.basis) : undefined,
      fundingAccountId: t.fundingAccountId ?? undefined,
      mortgageAmount: t.mortgageAmount ? parseFloat(t.mortgageAmount) : undefined,
      mortgageRate: t.mortgageRate ? parseFloat(t.mortgageRate) : undefined,
      mortgageTermMonths: t.mortgageTermMonths ?? undefined,
    })) as any,
    giftEvents: [],
  };

  return data;
}

function scanNaN(result: ReturnType<typeof runProjection>) {
  const hits: string[] = [];
  for (const row of result) {
    const checkObj = (prefix: string, obj: any) => {
      if (!obj) return;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number" && !Number.isFinite(v)) hits.push(`${row.year} ${prefix}.${k}=${v}`);
      }
    };
    checkObj("income", row.income);
    checkObj("expenses", row.expenses);
    checkObj("savings", row.savings);
    for (const [id, led] of Object.entries(row.accountLedgers ?? {})) {
      for (const [k, v] of Object.entries(led as any)) {
        if (typeof v === "number" && !Number.isFinite(v)) hits.push(`${row.year} ledger[${id}].${k}=${v}`);
      }
    }
    if ((row as any).taxResult) {
      checkObj("tax.income", (row as any).taxResult.income);
      checkObj("tax.flow", (row as any).taxResult.flow);
    }
  }
  return hits;
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error("Usage: npx tsx scripts/audit-cashflow.ts <client-uuid>");
    process.exit(1);
  }
  console.log(`Loading data for client ${clientId}...`);
  const data = await loadClientData(clientId);
  console.log(`Loaded: ${data.accounts.length} accounts, ${data.liabilities.length} liabilities, ${data.assetTransactions?.length ?? 0} asset txns`);

  // Dump asset-transactions summary
  console.log("\n── Asset transactions ──");
  for (const t of data.assetTransactions ?? []) {
    console.log(`  ${t.year} ${t.type}: ${t.name} accountId=${(t as any).accountId ?? (t as any).assetName ?? "?"}`);
  }

  // Dump real_estate accounts with propertyTax diagnostic
  console.log("\n── Real estate accounts ──");
  for (const a of data.accounts) {
    if ((a as any).category !== "real_estate") continue;
    const pt = (a as any).annualPropertyTax;
    console.log(`  ${a.id} ${a.name} annualPropertyTax=${pt} isFinite=${Number.isFinite(pt)}`);
  }

  console.log("\nRunning projection...");
  const result = runProjection(data);
  console.log(`Produced ${result.length} years`);

  const hits = scanNaN(result);
  console.log(`\n── NaN scan: ${hits.length} hit(s) ──`);
  for (const h of hits.slice(0, 60)) console.log("  " + h);
  if (hits.length > 60) console.log(`  ... +${hits.length - 60} more`);

  // Focus on year 2030 (per review)
  const y2030 = result.find((r) => r.year === 2030);
  if (y2030) {
    console.log("\n── Year 2030 diagnostic ──");
    console.log("  income.total=", y2030.income.total);
    console.log("  expenses.total=", y2030.expenses.total);
    console.log("  netCashFlow=", (y2030 as any).netCashFlow);
    for (const [id, led] of Object.entries(y2030.accountLedgers ?? {})) {
      const l = led as any;
      if (!Number.isFinite(l.endingValue) || !Number.isFinite(l.distributions) || !Number.isFinite(l.contributions)) {
        console.log(`  ledger[${id}] beg=${l.beginningValue} grow=${l.growth} contrib=${l.contributions} dist=${l.distributions} end=${l.endingValue}`);
      }
    }
  }

  // Compare year 2029 vs 2030 cash ledger
  const y2029 = result.find((r) => r.year === 2029);
  if (y2029 && y2030) {
    console.log("\n── 2029 vs 2030 cash ledgers ──");
    for (const [id, led29] of Object.entries(y2029.accountLedgers ?? {})) {
      const led30 = (y2030.accountLedgers ?? {})[id];
      if (!led30) continue;
      const a = data.accounts.find((x) => x.id === id);
      if ((a as any)?.category !== "cash") continue;
      console.log(`  ${id} ${a?.name}`);
      console.log(`    2029: end=${(led29 as any).endingValue} dist=${(led29 as any).distributions}`);
      console.log(`    2030: end=${(led30 as any).endingValue} dist=${(led30 as any).distributions}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
