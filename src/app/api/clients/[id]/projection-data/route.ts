import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  incomes,
  expenses,
  liabilities,
  savingsRules,
  withdrawalStrategies,
  planSettings,
  entities,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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
    ]);

    const [settings] = planSettingsRows;

    if (!settings) {
      return NextResponse.json({ error: "No plan settings found" }, { status: 404 });
    }

    // ── CMA resolution helpers ──────────────────────────────────────────────

    const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
    const allocsByPortfolio = new Map<string, typeof allocationRows>();
    for (const alloc of allocationRows) {
      const list = allocsByPortfolio.get(alloc.modelPortfolioId) ?? [];
      list.push(alloc);
      allocsByPortfolio.set(alloc.modelPortfolioId, list);
    }

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

    // ── Build response ──────────────────────────────────────────────────────

    // Convert Drizzle decimal strings to numbers for the engine
    return NextResponse.json({
      client: {
        firstName: client.firstName,
        lastName: client.lastName,
        dateOfBirth: client.dateOfBirth,
        retirementAge: client.retirementAge,
        planEndAge: client.planEndAge,
        spouseName: client.spouseName ?? undefined,
        spouseDob: client.spouseDob ?? undefined,
        spouseRetirementAge: client.spouseRetirementAge ?? undefined,
        filingStatus: client.filingStatus,
      },
      accounts: accountRows.map((a) => {
        let growthRate: number;
        let realization: { pctOrdinaryIncome: number; pctLtCapitalGains: number; pctQualifiedDividends: number; pctTaxExempt: number; turnoverPct: number } | undefined;

        const gs = a.growthSource ?? "default";

        if (gs === "model_portfolio" && a.modelPortfolioId) {
          const p = resolvePortfolio(a.modelPortfolioId);
          growthRate = p.geoReturn;
          realization = {
            pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : p.pctOi,
            pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : p.pctLtcg,
            pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : p.pctQdiv,
            pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : p.pctTaxEx,
            turnoverPct: parseFloat(a.turnoverPct ?? "0"),
          };
        } else if (gs === "custom" && a.growthRate != null) {
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
        };
      }),
      incomes: incomeRows.map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        annualAmount: parseFloat(i.annualAmount),
        startYear: i.startYear,
        endYear: i.endYear,
        growthRate: parseFloat(i.growthRate),
        owner: i.owner,
        claimingAge: i.claimingAge ?? undefined,
        linkedEntityId: i.linkedEntityId ?? undefined,
        ownerEntityId: i.ownerEntityId ?? undefined,
        cashAccountId: i.cashAccountId ?? undefined,
        inflationStartYear: i.inflationStartYear ?? undefined,
        taxType: i.taxType ?? undefined,
      })),
      expenses: expenseRows.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        annualAmount: parseFloat(e.annualAmount),
        startYear: e.startYear,
        endYear: e.endYear,
        growthRate: parseFloat(e.growthRate),
        ownerEntityId: e.ownerEntityId ?? undefined,
        cashAccountId: e.cashAccountId ?? undefined,
        inflationStartYear: e.inflationStartYear ?? undefined,
      })),
      liabilities: liabilityRows.map((l) => ({
        id: l.id,
        name: l.name,
        balance: parseFloat(l.balance),
        interestRate: parseFloat(l.interestRate),
        monthlyPayment: parseFloat(l.monthlyPayment),
        startYear: l.startYear,
        endYear: l.endYear,
        linkedPropertyId: l.linkedPropertyId ?? undefined,
        ownerEntityId: l.ownerEntityId ?? undefined,
      })),
      savingsRules: savingsRuleRows.map((s) => ({
        id: s.id,
        accountId: s.accountId,
        annualAmount: parseFloat(s.annualAmount),
        startYear: s.startYear,
        endYear: s.endYear,
        employerMatchPct: s.employerMatchPct != null ? parseFloat(s.employerMatchPct) : undefined,
        employerMatchCap: s.employerMatchCap != null ? parseFloat(s.employerMatchCap) : undefined,
        employerMatchAmount:
          s.employerMatchAmount != null ? parseFloat(s.employerMatchAmount) : undefined,
        annualLimit: s.annualLimit != null ? parseFloat(s.annualLimit) : undefined,
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
      },
      entities: entityRows.map((e) => ({
        id: e.id,
        includeInPortfolio: e.includeInPortfolio,
        isGrantor: e.isGrantor,
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
