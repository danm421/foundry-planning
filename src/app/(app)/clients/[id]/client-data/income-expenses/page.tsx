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
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import IncomeExpensesView from "@/components/income-expenses-view";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";

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

  const settings = planSettingsRows[0];

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
      }}
    />
  );
}
