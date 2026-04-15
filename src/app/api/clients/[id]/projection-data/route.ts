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

    // Fetch all projection data in parallel
    const [
      accountRows,
      incomeRows,
      expenseRows,
      liabilityRows,
      savingsRuleRows,
      withdrawalRows,
      planSettingsRows,
      entityRows,
    ] = await Promise.all([
      db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
      db.select().from(incomes).where(and(eq(incomes.clientId, id), eq(incomes.scenarioId, scenario.id))),
      db.select().from(expenses).where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenario.id))),
      db.select().from(liabilities).where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
      db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
      db.select().from(withdrawalStrategies).where(and(eq(withdrawalStrategies.clientId, id), eq(withdrawalStrategies.scenarioId, scenario.id))),
      db.select().from(planSettings).where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
      db.select().from(entities).where(eq(entities.clientId, id)),
    ]);

    const [settings] = planSettingsRows;

    if (!settings) {
      return NextResponse.json({ error: "No plan settings found" }, { status: 404 });
    }

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
        const defaultByCategory: Record<string, string> = {
          taxable: String(settings.defaultGrowthTaxable),
          cash: String(settings.defaultGrowthCash),
          retirement: String(settings.defaultGrowthRetirement),
          real_estate: String(settings.defaultGrowthRealEstate),
          business: String(settings.defaultGrowthBusiness),
          life_insurance: String(settings.defaultGrowthLifeInsurance),
        };
        const effectiveGrowth = a.growthRate ?? defaultByCategory[a.category] ?? "0.07";
        return {
          id: a.id,
          name: a.name,
          category: a.category,
          subType: a.subType,
          owner: a.owner,
          value: parseFloat(a.value),
          basis: parseFloat(a.basis),
          growthRate: parseFloat(effectiveGrowth),
          rmdEnabled: a.rmdEnabled,
          ownerEntityId: a.ownerEntityId ?? undefined,
          isDefaultChecking: a.isDefaultChecking,
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
