import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
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
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { dbRowToTaxYearParameters } from "@/lib/tax/dbMapper";
import { resolveInflationRate } from "@/lib/inflation";

// GET /api/clients/[id]/projection-data — fetch all data needed for the projection engine
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    // Verify client access
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Get base case scenario
    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

    if (!scenario) {
      return NextResponse.json({ error: "No base case scenario found" }, { status: 404 });
    }

    // Fetch all projection data in parallel (including CMA data)
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
      db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
      db.select().from(incomes).where(and(eq(incomes.clientId, id), eq(incomes.scenarioId, scenario.id))),
      db.select().from(expenses).where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenario.id))),
      db.select().from(liabilities).where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
      db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
      db.select().from(withdrawalStrategies).where(and(eq(withdrawalStrategies.clientId, id), eq(withdrawalStrategies.scenarioId, scenario.id))),
      db.select().from(planSettings).where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
      db.select().from(entities).where(eq(entities.clientId, id)),
      db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
      db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
      db.select().from(extraPayments),
      db.select().from(transfers).where(and(eq(transfers.clientId, id), eq(transfers.scenarioId, scenario.id))),
      db.select().from(transferSchedules),
      db.select().from(assetTransactions).where(and(eq(assetTransactions.clientId, id), eq(assetTransactions.scenarioId, scenario.id))),
    ]);

    // Load schedule overrides for all incomes, expenses, and savings rules
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

    // Build lookup maps: entityId → Map<year, amount>
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

    if (!settings) {
      return NextResponse.json({ error: "No plan settings found" }, { status: 404 });
    }

    // Load tax year parameters for the projection engine
    const taxYearRows = await db
      .select()
      .from(taxYearParameters)
      .orderBy(asc(taxYearParameters.year));
    const parsedTaxRows = taxYearRows.map(dbRowToTaxYearParameters);

    // Load deductions for the base case scenario
    const deductionRows = await db
      .select()
      .from(clientDeductions)
      .where(and(eq(clientDeductions.clientId, id), eq(clientDeductions.scenarioId, scenario.id)));

    const parsedDeductions = deductionRows.map((d) => ({
      type: d.type,
      annualAmount: parseFloat(d.annualAmount),
      growthRate: parseFloat(d.growthRate),
      startYear: d.startYear,
      endYear: d.endYear,
    }));

    // Load account-level asset allocations (for asset_mix growth source)
    let accountAllocRows: (typeof accountAssetAllocations.$inferSelect)[] = [];
    if (accountRows.length > 0) {
      accountAllocRows = await db
        .select()
        .from(accountAssetAllocations)
        .where(
          inArray(
            accountAssetAllocations.accountId,
            accountRows.map((a) => a.id)
          )
        );
    }

    const allocsByAccount = new Map<string, typeof accountAllocRows>();
    for (const row of accountAllocRows) {
      const list = allocsByAccount.get(row.accountId) ?? [];
      list.push(row);
      allocsByAccount.set(row.accountId, list);
    }

    // ── CMA resolution helpers ──────────────────────────────────────────────

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

    // Resolve a model portfolio to the inputs the deterministic cash-flow engine
    // needs. We blend the geometric return — the straight-line projection
    // compounds a single rate each year, and geometric return is the correct
    // single-rate summary of a volatile series. Arithmetic mean and volatility
    // are intentionally NOT read here; they stay on the asset class for the
    // future Monte Carlo simulator, which will sample returns with drift and
    // dispersion (that's where sequence-of-returns risk lives).
    function resolvePortfolio(portfolioId: string) {
      const allocs = allocsByPortfolio.get(portfolioId) ?? [];
      let geoReturn = 0;
      let pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
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
      let totalWeight = 0;
      let geoReturn = 0;
      let pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
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

    // Resolve category default growth source from plan_settings
    function resolveCategoryDefault(category: string): {
      rate: number;
      realization?: { pctOrdinaryIncome: number; pctLtCapitalGains: number; pctQualifiedDividends: number; pctTaxExempt: number; turnoverPct: number };
    } {
      const sourceLookup: Record<string, { source: string; portfolioId: string | null; customRate: string }> = {
        taxable: { source: settings.growthSourceTaxable, portfolioId: settings.modelPortfolioIdTaxable, customRate: String(settings.defaultGrowthTaxable) },
        cash: { source: settings.growthSourceCash, portfolioId: settings.modelPortfolioIdCash, customRate: String(settings.defaultGrowthCash) },
        retirement: { source: settings.growthSourceRetirement, portfolioId: settings.modelPortfolioIdRetirement, customRate: String(settings.defaultGrowthRetirement) },
      };
      const entry = sourceLookup[category];
      if (!entry) {
        // Non-investable categories: use flat defaults
        const flatDefaults: Record<string, string> = {
          real_estate: String(settings.defaultGrowthRealEstate),
          business: String(settings.defaultGrowthBusiness),
          life_insurance: String(settings.defaultGrowthLifeInsurance),
        };
        return { rate: parseFloat(flatDefaults[category] ?? "0.05") };
      }

      if (entry.source === "model_portfolio" && entry.portfolioId) {
        const p = resolvePortfolio(entry.portfolioId);
        return {
          rate: p.geoReturn,
          realization: { pctOrdinaryIncome: p.pctOi, pctLtCapitalGains: p.pctLtcg, pctQualifiedDividends: p.pctQdiv, pctTaxExempt: p.pctTaxEx, turnoverPct: 0 },
        };
      }
      return { rate: parseFloat(entry.customRate) };
    }

    function getCategoryGrowthSource(category: string): string {
      const sourceLookup: Record<string, string> = {
        taxable: settings.growthSourceTaxable,
        cash: settings.growthSourceCash,
        retirement: settings.growthSourceRetirement,
      };
      return sourceLookup[category] ?? "custom";
    }

    // Resolve the effective inflation rate for this plan
    let clientInflationOverride: { geometricReturn: string } | null = null;
    if (settings.useCustomCma && inflationClass) {
      const [override] = await db
        .select({ geometricReturn: clientCmaOverrides.geometricReturn })
        .from(clientCmaOverrides)
        .where(and(
          eq(clientCmaOverrides.clientId, id),
          eq(clientCmaOverrides.sourceAssetClassId, inflationClass.id),
        ));
      if (override) clientInflationOverride = override;
    }

    // Resolve the household's effective inflation rate for per-row "grow at inflation"
    // consumers (accounts, income, expenses, savings rules). NOTE: the projection
    // engine's tax-bracket indexing and SS-wage-growth fallback paths still read the
    // raw planSettings.inflationRate decimal directly, which can diverge from this
    // resolved value when source = "asset_class". Aligning those is tracked in
    // docs/FUTURE_WORK.md ("Align plan_settings.inflation_rate consumers with the
    // resolver").
    const resolvedInflationRate = resolveInflationRate(
      {
        inflationRateSource: settings.inflationRateSource,
        inflationRate: settings.inflationRate,
      },
      inflationClass ? { geometricReturn: inflationClass.geometricReturn } : null,
      clientInflationOverride,
    );

    // ── Build response ──────────────────────────────────────────────────────

    // Convert Drizzle decimal strings to numbers for the engine
    return NextResponse.json({
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
      },
      accounts: accountRows.map((a) => {
        let growthRate: number;
        let realization: { pctOrdinaryIncome: number; pctLtCapitalGains: number; pctQualifiedDividends: number; pctTaxExempt: number; turnoverPct: number } | undefined;

        const gs = a.growthSource ?? "default";

        // Determine effective growth source (category default may point to asset_mix)
        let effectiveSource = gs;
        if (effectiveSource === "default") {
          const catSource = getCategoryGrowthSource(a.category);
          if (catSource === "asset_mix") {
            effectiveSource = "asset_mix";
          }
        }

        if (effectiveSource === "inflation") {
          growthRate = resolvedInflationRate;
        } else if (effectiveSource === "model_portfolio" && a.modelPortfolioId) {
          const p = resolvePortfolio(a.modelPortfolioId);
          growthRate = p.geoReturn;
          realization = {
            pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : p.pctOi,
            pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : p.pctLtcg,
            pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : p.pctQdiv,
            pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : p.pctTaxEx,
            turnoverPct: parseFloat(a.turnoverPct ?? "0"),
          };
        } else if (effectiveSource === "asset_mix") {
          const resolved = resolveAccountAllocations(a.id);
          growthRate = resolved.geoReturn;
          realization = {
            pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : resolved.pctOi,
            pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : resolved.pctLtcg,
            pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : resolved.pctQdiv,
            pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : resolved.pctTaxEx,
            turnoverPct: parseFloat(a.turnoverPct ?? "0"),
          };
        } else if (effectiveSource === "custom" && a.growthRate != null) {
          growthRate = parseFloat(a.growthRate);
        } else {
          // "default" — resolve from category default in plan_settings
          const catDefault = resolveCategoryDefault(a.category);
          growthRate = catDefault.rate;
          realization = catDefault.realization;
        }

        // Cash accounts: always 100% OI regardless of portfolio
        if (a.category === "cash") {
          realization = { pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, turnoverPct: 0 };
        }

        // Retirement accounts: growth is tax-deferred (pre-tax) or tax-free (Roth).
        // Withdrawals are taxed as OI by the existing withdrawal logic. No per-year
        // realization split applies.
        if (a.category === "retirement") {
          realization = undefined;
        }

        // Non-investable categories: no realization, use flat defaults
        if (["real_estate", "business", "life_insurance"].includes(a.category)) {
          const flatDefaults: Record<string, string> = {
            real_estate: String(settings.defaultGrowthRealEstate),
            business: String(settings.defaultGrowthBusiness),
            life_insurance: String(settings.defaultGrowthLifeInsurance),
          };
          growthRate = a.growthRate != null ? parseFloat(a.growthRate) : parseFloat(flatDefaults[a.category] ?? "0.04");
          realization = undefined;
        }

        return {
          id: a.id,
          name: a.name,
          category: a.category,
          subType: a.subType,
          owner: a.owner,
          value: parseFloat(a.value),
          basis: parseFloat(a.basis),
          growthRate,
          rmdEnabled: a.rmdEnabled,
          ownerEntityId: a.ownerEntityId ?? undefined,
          isDefaultChecking: a.isDefaultChecking,
          realization,
          annualPropertyTax: parseFloat(a.annualPropertyTax),
          propertyTaxGrowthRate: parseFloat(a.propertyTaxGrowthRate),
        };
      }),
      incomes: incomeRows.map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        annualAmount: parseFloat(i.annualAmount),
        startYear: i.startYear,
        endYear: i.endYear,
        growthRate: i.growthSource === "inflation" ? resolvedInflationRate : parseFloat(i.growthRate),
        owner: i.owner,
        claimingAge: i.claimingAge ?? undefined,
        linkedEntityId: i.linkedEntityId ?? undefined,
        ownerEntityId: i.ownerEntityId ?? undefined,
        cashAccountId: i.cashAccountId ?? undefined,
        inflationStartYear: i.inflationStartYear ?? undefined,
        taxType: i.taxType ?? undefined,
        scheduleOverrides: incomeOverrideMap.get(i.id),
      })),
      expenses: expenseRows.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        annualAmount: parseFloat(e.annualAmount),
        startYear: e.startYear,
        endYear: e.endYear,
        growthRate: e.growthSource === "inflation" ? resolvedInflationRate : parseFloat(e.growthRate),
        ownerEntityId: e.ownerEntityId ?? undefined,
        cashAccountId: e.cashAccountId ?? undefined,
        inflationStartYear: e.inflationStartYear ?? undefined,
        deductionType: e.deductionType ?? undefined,
        scheduleOverrides: expenseOverrideMap.get(e.id),
      })),
      liabilities: liabilityRows.map((l) => ({
        id: l.id,
        name: l.name,
        balance: parseFloat(l.balance),
        interestRate: parseFloat(l.interestRate),
        monthlyPayment: parseFloat(l.monthlyPayment),
        startYear: l.startYear,
        startMonth: l.startMonth,
        termMonths: l.termMonths,
        balanceAsOfMonth: l.balanceAsOfMonth ?? undefined,
        balanceAsOfYear: l.balanceAsOfYear ?? undefined,
        linkedPropertyId: l.linkedPropertyId ?? undefined,
        ownerEntityId: l.ownerEntityId ?? undefined,
        isInterestDeductible: l.isInterestDeductible,
        extraPayments: extraPaymentRows
          .filter((ep) => ep.liabilityId === l.id)
          .map((ep) => ({
            id: ep.id,
            liabilityId: ep.liabilityId,
            year: ep.year,
            type: ep.type,
            amount: parseFloat(ep.amount),
          })),
      })),
      savingsRules: savingsRuleRows.map((s) => ({
        id: s.id,
        accountId: s.accountId,
        annualAmount: parseFloat(s.annualAmount),
        annualPercent: s.annualPercent != null ? parseFloat(s.annualPercent) : null,
        isDeductible: s.isDeductible,
        startYear: s.startYear,
        endYear: s.endYear,
        growthRate: s.growthSource === "inflation" ? resolvedInflationRate : Number(s.growthRate ?? 0),
        employerMatchPct: s.employerMatchPct != null ? parseFloat(s.employerMatchPct) : undefined,
        employerMatchCap: s.employerMatchCap != null ? parseFloat(s.employerMatchCap) : undefined,
        employerMatchAmount:
          s.employerMatchAmount != null ? parseFloat(s.employerMatchAmount) : undefined,
        scheduleOverrides: savingsOverrideMap.get(s.id),
      })),
      withdrawalStrategy: withdrawalRows.map((w) => ({
        accountId: w.accountId,
        priorityOrder: w.priorityOrder,
        startYear: w.startYear,
        endYear: w.endYear,
      })),
      planSettings: {
        flatFederalRate: parseFloat(settings.flatFederalRate),
        flatStateRate: parseFloat(settings.flatStateRate),
        inflationRate: parseFloat(settings.inflationRate),
        planStartYear: settings.planStartYear,
        planEndYear: settings.planEndYear,
        taxEngineMode: settings.taxEngineMode,
        taxInflationRate: settings.taxInflationRate != null ? parseFloat(settings.taxInflationRate) : null,
        ssWageGrowthRate: settings.ssWageGrowthRate != null ? parseFloat(settings.ssWageGrowthRate) : null,
      },
      entities: entityRows.map((e) => ({
        id: e.id,
        includeInPortfolio: e.includeInPortfolio,
        isGrantor: e.isGrantor,
      })),
      taxYearRows: parsedTaxRows,
      deductions: parsedDeductions,
      transfers: transferRows.map((t) => {
        const schedules = transferScheduleRows
          .filter((s) => s.transferId === t.id)
          .map((s) => ({ year: s.year, amount: parseFloat(s.amount) }));
        return {
          id: t.id,
          name: t.name,
          sourceAccountId: t.sourceAccountId,
          targetAccountId: t.targetAccountId,
          amount: parseFloat(t.amount),
          mode: t.mode,
          startYear: t.startYear,
          endYear: t.endYear ?? undefined,
          growthRate: parseFloat(t.growthRate),
          schedules,
        };
      }),
      assetTransactions: assetTransactionRows.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        year: t.year,
        accountId: t.accountId ?? undefined,
        overrideSaleValue: t.overrideSaleValue ? parseFloat(t.overrideSaleValue) : undefined,
        overrideBasis: t.overrideBasis ? parseFloat(t.overrideBasis) : undefined,
        transactionCostPct: t.transactionCostPct ? parseFloat(t.transactionCostPct) : undefined,
        transactionCostFlat: t.transactionCostFlat ? parseFloat(t.transactionCostFlat) : undefined,
        proceedsAccountId: t.proceedsAccountId ?? undefined,
        assetName: t.assetName ?? undefined,
        assetCategory: t.assetCategory ?? undefined,
        assetSubType: t.assetSubType ?? undefined,
        purchasePrice: t.purchasePrice ? parseFloat(t.purchasePrice) : undefined,
        growthRate: t.growthRate ? parseFloat(t.growthRate) : undefined,
        basis: t.basis ? parseFloat(t.basis) : undefined,
        fundingAccountId: t.fundingAccountId ?? undefined,
        mortgageAmount: t.mortgageAmount ? parseFloat(t.mortgageAmount) : undefined,
        mortgageRate: t.mortgageRate ? parseFloat(t.mortgageRate) : undefined,
        mortgageTermMonths: t.mortgageTermMonths ?? undefined,
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/projection-data error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
