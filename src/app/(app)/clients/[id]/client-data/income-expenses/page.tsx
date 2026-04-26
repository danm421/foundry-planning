import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  incomeScheduleOverrides,
  expenseScheduleOverrides,
  savingsScheduleOverrides,
  assetClasses,
  clientCmaOverrides,
  planSettings,
  entities,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import IncomeExpensesView from "@/components/income-expenses-view";
import { buildClientMilestones } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  expenseEngineToView,
  incomeEngineToView,
  savingsRuleEngineToView,
} from "@/lib/scenario/view-adapters";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function IncomeExpensesPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const { effectiveTree } = await loadEffectiveTree(id, firmId, sp.scenario ?? "base", {});

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
          No base case scenario found.
        </div>
      </ClientDataPageShell>
    );
  }

  const incomes = effectiveTree.incomes.map(incomeEngineToView);
  // Synthesized life-insurance premiums (source: "policy") are derived from
  // life-insurance accounts at load time; they aren't real expense rows and
  // shouldn't appear in the manual income-expenses editor.
  const expenses = effectiveTree.expenses
    .filter((e) => e.source !== "policy")
    .map(expenseEngineToView);
  const savingsRulesView = effectiveTree.savingsRules.map(savingsRuleEngineToView);

  const incomeIds = incomes.map((i) => i.id);
  const expenseIds = expenses.map((e) => e.id);
  const savingsRuleIds = savingsRulesView.map((s) => s.id);

  const [incOverrides, expOverrides, savOverrides, planSettingsRows, entityRows] = await Promise.all([
    incomeIds.length > 0
      ? db.select().from(incomeScheduleOverrides).where(inArray(incomeScheduleOverrides.incomeId, incomeIds))
      : Promise.resolve([]),
    expenseIds.length > 0
      ? db.select().from(expenseScheduleOverrides).where(inArray(expenseScheduleOverrides.expenseId, expenseIds))
      : Promise.resolve([]),
    savingsRuleIds.length > 0
      ? db.select().from(savingsScheduleOverrides).where(inArray(savingsScheduleOverrides.savingsRuleId, savingsRuleIds))
      : Promise.resolve([]),
    db.select().from(planSettings).where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
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

  const accountsForView = effectiveTree.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType,
    isDefaultChecking: a.isDefaultChecking ?? null,
    ownerEntityId: a.ownerEntityId ?? null,
  }));

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <IncomeExpensesView
      clientId={id}
      initialIncomes={incomes}
      initialExpenses={expenses}
      initialSavingsRules={savingsRulesView}
      accounts={accountsForView}
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
      ssClientInfo={{
        firstName: client.firstName,
        lastName: client.lastName,
        dateOfBirth: client.dateOfBirth,
        retirementAge: client.retirementAge,
        planEndAge: client.planEndAge,
        spouseName: client.spouseName ?? undefined,
        spouseDob: client.spouseDob ?? undefined,
        spouseRetirementAge: client.spouseRetirementAge ?? undefined,
        filingStatus: (client.filingStatus ?? "single") as "single" | "married_joint" | "married_separate" | "head_of_household",
      }}
      ssPlanSettings={settings ? {
        flatFederalRate: Number(settings.flatFederalRate),
        flatStateRate: Number(settings.flatStateRate),
        inflationRate: resolvedInflationRate,
        planStartYear,
        planEndYear,
      } : undefined}
    />
    </ClientDataPageShell>
  );
}
