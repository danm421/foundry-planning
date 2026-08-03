import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assetClasses,
  clientCmaOverrides,
  clients,
  crmHouseholdContacts,
  entities,
  expenseScheduleOverrides,
  familyMembers,
  incomeScheduleOverrides,
  planSettings,
  savingsScheduleOverrides,
  scenarios,
} from "@/db/schema";
import type { IncomeExpensesViewProps } from "@/components/income-expenses-view";
import { buildClientMilestones } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { buildFlowScenarioFields } from "@/lib/inline-edit/flow-write";
import { controllingEntity } from "@/engine/ownership";
import {
  expenseEngineToView,
  incomeEngineToView,
  savingsRuleEngineToView,
} from "@/lib/scenario/view-adapters";

/** Everything IncomeExpensesView needs except the two props that say WHICH
 *  slice of it a given wizard step renders. */
export type CashFlowStepData = Omit<IncomeExpensesViewProps, "embed" | "section">;

/**
 * Loader behind both flow-shaped wizard steps — Goals and Cash Flow. The two
 * render the same view with a different `section`, so they must be fed from
 * one place or the goal rows and the expense rows drift apart.
 *
 * Mirrors the standard `/clients/[id]/details/income-expenses` loader — see
 * `income-expenses-content.tsx` for the canonical version. Returns null when
 * the client, their primary contact's DOB, or the base scenario is missing;
 * the callers render their own not-found card.
 */
export async function loadCashFlowStepData(
  clientId: string,
  firmId: string,
): Promise<CashFlowStepData | null> {
  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!clientRow) return null;

  // CRM contacts — sole identity source.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) return null;
  const client = {
    ...clientRow,
    firstName: primaryContact.firstName,
    lastName: primaryContact.lastName,
    dateOfBirth: primaryContact.dateOfBirth,
    spouseName: spouseContact?.firstName ?? null,
    spouseLastName: spouseContact?.lastName ?? null,
    spouseDob: spouseContact?.dateOfBirth ?? null,
  };

  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return null;

  const incomes = effectiveTree.incomes.map(incomeEngineToView);
  const effectiveExpenses = effectiveTree.expenses.filter((e) => e.source !== "policy");
  const expenses = effectiveExpenses.map(expenseEngineToView);
  const savingsRulesView = effectiveTree.savingsRules.map(savingsRuleEngineToView);

  // Built the same way as the details page's — see the long comment there. The
  // wizard always loads BASE, so these field sets are never diffed against a
  // scenario in practice; passing an EMPTY map instead would be wrong, because
  // the view refuses an inline write with no entry in ANY mode, which would
  // silently kill the wizard's existing inline expense-amount editing.
  const flowScenarioFields: Record<string, Record<string, unknown>> = Object.fromEntries([
    ...effectiveTree.incomes.map((i) => [i.id, buildFlowScenarioFields(i)] as const),
    ...effectiveExpenses.map((e) => [e.id, buildFlowScenarioFields(e)] as const),
  ]);

  const incomeIds = incomes.map((i) => i.id);
  const expenseIds = expenses.map((e) => e.id);
  const savingsRuleIds = savingsRulesView.map((s) => s.id);

  const [incOverrides, expOverrides, savOverrides, planSettingsRows, entityRows, familyMemberRows] =
    await Promise.all([
      incomeIds.length > 0
        ? db.select().from(incomeScheduleOverrides).where(inArray(incomeScheduleOverrides.incomeId, incomeIds))
        : Promise.resolve([]),
      expenseIds.length > 0
        ? db.select().from(expenseScheduleOverrides).where(inArray(expenseScheduleOverrides.expenseId, expenseIds))
        : Promise.resolve([]),
      savingsRuleIds.length > 0
        ? db.select().from(savingsScheduleOverrides).where(inArray(savingsScheduleOverrides.savingsRuleId, savingsRuleIds))
        : Promise.resolve([]),
      db
        .select()
        .from(planSettings)
        .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id))),
      db.select().from(entities).where(eq(entities.clientId, clientId)).orderBy(asc(entities.name)),
      db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.clientId, clientId))
        .orderBy(asc(familyMembers.firstName)),
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
      .where(
        and(
          eq(clientCmaOverrides.clientId, clientId),
          eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
        ),
      );
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
    value: a.value,
    isDefaultChecking: a.isDefaultChecking ?? null,
    ownerEntityId: controllingEntity(a) ?? null,
    // 529s carry no family_member owners — the loader synthesizes a sentinel
    // external_beneficiary owner instead (see engine/ownership.ts). Fall back
    // to the account's actual beneficiary so the education goal's
    // dedicated-funding picker doesn't silently exclude them.
    ownerFamilyMemberIds:
      a.category === "education_savings"
        ? a.education529?.beneficiaryFamilyMemberId
          ? [a.education529.beneficiaryFamilyMemberId]
          : []
        : a.owners.filter((o) => o.kind === "family_member").map((o) => o.familyMemberId),
  }));

  return {
    clientId,
    initialIncomes: incomes,
    initialExpenses: expenses,
    initialSavingsRules: savingsRulesView,
    accounts: accountsForView,
    entities: entityRows.map((e) => ({ id: e.id, name: e.name })),
    familyMembers: familyMemberRows.map((fm) => ({
      id: fm.id,
      firstName: fm.firstName,
      lastName: fm.lastName,
      role: fm.role,
      dateOfBirth: fm.dateOfBirth,
    })),
    ownerNames: {
      clientName: `${client.firstName} ${client.lastName}`,
      spouseName: client.spouseName
        ? `${client.spouseName} ${client.spouseLastName ?? client.lastName}`.trim()
        : null,
    },
    clientInfo: {
      clientRetirementYear,
      clientEndYear,
      spouseRetirementYear,
      spouseEndYear,
      planStartYear,
      planEndYear,
      milestones,
      clientDob: client.dateOfBirth,
      spouseDob: client.spouseDob ?? null,
    },
    incomeSchedules: incomeScheduleMap,
    expenseSchedules: expenseScheduleMap,
    savingsSchedules: savingsScheduleMap,
    flowScenarioFields,
    resolvedInflationRate,
    ssClientInfo: {
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: client.dateOfBirth,
      retirementAge: client.retirementAge,
      planEndAge: client.planEndAge,
      spouseName: client.spouseName ?? undefined,
      spouseDob: client.spouseDob ?? undefined,
      spouseRetirementAge: client.spouseRetirementAge ?? undefined,
      filingStatus: (client.filingStatus ?? "single") as
        | "single"
        | "married_joint"
        | "married_separate"
        | "head_of_household",
    },
    ssPlanSettings: settings
      ? {
          flatFederalRate: Number(settings.flatFederalRate),
          flatStateRate: Number(settings.flatStateRate),
          inflationRate: resolvedInflationRate,
          planStartYear,
          planEndYear,
        }
      : undefined,
  };
}
