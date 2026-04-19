import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  incomes,
  expenses,
  savingsRules,
  planSettings,
  entities,
  incomeScheduleOverrides,
  expenseScheduleOverrides,
  savingsScheduleOverrides,
  assetClasses,
  clientCmaOverrides,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import IncomeExpensesView from "@/components/income-expenses-view";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function IncomeExpensesPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No base case scenario found.
      </div>
    );
  }

  const [incomeRows, expenseRows, savingsRuleRows, accountRows, planSettingsRows, entityRows] = await Promise.all([
    db.select().from(incomes).where(and(eq(incomes.clientId, id), eq(incomes.scenarioId, scenario.id))),
    db.select().from(expenses).where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenario.id))),
    db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
    db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
    db.select().from(planSettings).where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
  ]);

  const incomeIds = incomeRows.map((i) => i.id);
  const expenseIds = expenseRows.map((e) => e.id);
  const savingsRuleIds = savingsRuleRows.map((s) => s.id);

  const [incOverrides, expOverrides, savOverrides] = await Promise.all([
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

  const incomeScheduleMap: Record<string, { year: number; amount: number }[]> = {};
  for (const row of incOverrides) {
    (incomeScheduleMap[row.incomeId] ??= []).push({ year: row.year, amount: parseFloat(row.amount) });
  }

  const expenseScheduleMap: Record<string, { year: number; amount: number }[]> = {};
  for (const row of expOverrides) {
    (expenseScheduleMap[row.expenseId] ??= []).push({ year: row.year, amount: parseFloat(row.amount) });
  }

  const savingsScheduleMap: Record<string, { year: number; amount: number }[]> = {};
  for (const row of savOverrides) {
    (savingsScheduleMap[row.savingsRuleId] ??= []).push({ year: row.year, amount: parseFloat(row.amount) });
  }

  const settings = planSettingsRows[0];

  const [firmInflationAc] = await db
    .select({ id: assetClasses.id, geometricReturn: assetClasses.geometricReturn })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.slug, "inflation")));

  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings?.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(
        eq(clientCmaOverrides.clientId, id),
        eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
      ));
    if (override) clientInflationOverride = override;
  }

  const resolvedInflationRate = resolveInflationRate(
    settings
      ? { inflationRateSource: settings.inflationRateSource, inflationRate: settings.inflationRate }
      : { inflationRateSource: "custom", inflationRate: 0.03 },
    firmInflationAc ?? null,
    clientInflationOverride,
  );

  const clientBirthYear = new Date(client.dateOfBirth).getFullYear();
  const clientRetirementYear = clientBirthYear + client.retirementAge;
  const clientEndYear = clientBirthYear + client.planEndAge;

  let spouseRetirementYear: number | undefined;
  let spouseEndYear: number | undefined;
  if (client.spouseDob) {
    const spouseBirthYear = new Date(client.spouseDob).getFullYear();
    if (client.spouseRetirementAge) spouseRetirementYear = spouseBirthYear + client.spouseRetirementAge;
    spouseEndYear = spouseBirthYear + client.planEndAge;
  }

  const planStartYear = settings?.planStartYear ?? new Date().getFullYear();
  const planEndYear = settings?.planEndYear ?? new Date().getFullYear() + 30;
  const milestones = buildClientMilestones(client, planStartYear, planEndYear);

  // Resolution-on-read: re-resolve milestone refs and update stale years
  for (const row of incomeRows) {
    if (row.startYearRef) {
      const resolved = resolveMilestone(row.startYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.startYear) {
        row.startYear = resolved;
        db.update(incomes).set({ startYear: resolved }).where(eq(incomes.id, row.id));
      }
    }
    if (row.endYearRef) {
      const resolved = resolveMilestone(row.endYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.endYear) {
        row.endYear = resolved;
        db.update(incomes).set({ endYear: resolved }).where(eq(incomes.id, row.id));
      }
    }
  }
  for (const row of expenseRows) {
    if (row.startYearRef) {
      const resolved = resolveMilestone(row.startYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.startYear) {
        row.startYear = resolved;
        db.update(expenses).set({ startYear: resolved }).where(eq(expenses.id, row.id));
      }
    }
    if (row.endYearRef) {
      const resolved = resolveMilestone(row.endYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.endYear) {
        row.endYear = resolved;
        db.update(expenses).set({ endYear: resolved }).where(eq(expenses.id, row.id));
      }
    }
  }
  for (const row of savingsRuleRows) {
    if (row.startYearRef) {
      const resolved = resolveMilestone(row.startYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.startYear) {
        row.startYear = resolved;
        db.update(savingsRules).set({ startYear: resolved }).where(eq(savingsRules.id, row.id));
      }
    }
    if (row.endYearRef) {
      const resolved = resolveMilestone(row.endYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.endYear) {
        row.endYear = resolved;
        db.update(savingsRules).set({ endYear: resolved }).where(eq(savingsRules.id, row.id));
      }
    }
  }

  return (
    <IncomeExpensesView
      clientId={id}
      initialIncomes={incomeRows}
      initialExpenses={expenseRows}
      initialSavingsRules={savingsRuleRows}
      accounts={accountRows}
      entities={entityRows.map((e) => ({ id: e.id, name: e.name }))}
      ownerNames={{
        clientName: `${client.firstName} ${client.lastName}`,
        spouseName: client.spouseName
          ? `${client.spouseName} ${client.spouseLastName ?? client.lastName}`.trim()
          : null,
      }}
      clientInfo={{
        clientRetirementYear,
        clientEndYear,
        spouseRetirementYear,
        spouseEndYear,
        planStartYear,
        planEndYear,
        milestones,
        clientDob: client.dateOfBirth,
        spouseDob: client.spouseDob ?? null,
      }}
      incomeSchedules={incomeScheduleMap}
      expenseSchedules={expenseScheduleMap}
      savingsSchedules={savingsScheduleMap}
      resolvedInflationRate={resolvedInflationRate}
    />
  );
}
