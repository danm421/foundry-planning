import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  crmHouseholdContacts,
  entities,
  familyMembers,
  planSettings,
  scenarios,
} from "@/db/schema";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { requireClientAccess } from "@/lib/clients/authz";
import { ageOnDate, birthYearFromDob, yearForAge } from "@/lib/age-year";
import { buildClientMilestones } from "@/lib/milestones";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  accountEngineToView,
  expenseEngineToView,
  incomeEngineToView,
  savingsRuleEngineToView,
  type ExpenseView,
  type IncomeView,
  type SavingsRuleView,
} from "@/lib/scenario/view-adapters";
import { buildMapGoals } from "@/lib/household-map/goals";
import { moneyLabel } from "@/lib/household-map/format";
import {
  ACCOUNT_CATEGORY,
  expenseToMapItem,
  incomeToMapItem,
  savingsToMapItem,
  toMapItem,
} from "@/lib/household-map/map-items";
import type { ColumnContext, MapItem, MapPerson } from "@/lib/household-map/types";
import type { Account, Expense, Income, Liability, SavingsRule } from "@/engine/types";
import HouseholdMapView from "@/components/household-map/household-map-view";

interface MapContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function MapContent({ clientId: id, scenarioParam }: MapContentProps) {
  // Access gate + client row + permission in one call. Returns the OWNING
  // firmId, which is what the engine loader needs (a cross-firm shared client
  // still loads against the firm that owns it).
  const access = await requireClientAccess(id).catch((err: unknown) => {
    // Narrow: only an auth denial becomes a 404. A DB/runtime fault must stay
    // a 500 rather than being laundered into "not found".
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) return null;
    throw err;
  });
  if (!access) notFound();
  const { client: clientRow, firmId, permission } = access;

  // CRM contacts — sole source of identity (firstName, DOB) for milestone math.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) notFound();
  const client = {
    ...clientRow,
    dateOfBirth: primaryContact.dateOfBirth,
    spouseDob: spouseContact?.dateOfBirth ?? null,
  };

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  const [entityRows, familyMemberRows, settingsRows, { effectiveTree }] = await Promise.all([
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    db
      .select({
        id: familyMembers.id,
        role: familyMembers.role,
        firstName: familyMembers.firstName,
        dateOfBirth: familyMembers.dateOfBirth,
      })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.role), asc(familyMembers.firstName)),
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
  ]);

  const settings = settingsRows[0];
  const planStartYear = settings?.planStartYear ?? new Date().getFullYear();
  const planEndYear = settings?.planEndYear ?? new Date().getFullYear() + 30;

  const milestones = buildClientMilestones(
    {
      dateOfBirth: client.dateOfBirth,
      retirementAge: client.retirementAge,
      planEndAge: client.planEndAge,
      spouseDob: client.spouseDob,
      spouseRetirementAge: client.spouseRetirementAge,
    },
    planStartYear,
    planEndYear,
  );

  const ctx: ColumnContext = {
    roleByFamilyMemberId: new Map(familyMemberRows.map((f) => [f.id, f.role])),
    nameByFamilyMemberId: new Map(familyMemberRows.map((f) => [f.id, f.firstName])),
    nameByEntityId: new Map(entityRows.map((e) => [e.id, e.name])),
  };

  const accountById = new Map<string, Account>(effectiveTree.accounts.map((a) => [a.id, a]));

  const items: MapItem[] = [
    ...effectiveTree.accounts.map((a: Account) =>
      toMapItem(a, "account", ACCOUNT_CATEGORY[a.category], a.value, ctx),
    ),
    ...effectiveTree.liabilities.map((l: Liability) =>
      toMapItem(l, "liability", "debt", -l.balance, ctx),
    ),
    ...effectiveTree.incomes.map((i: Income) => incomeToMapItem(i, ctx)),
    ...effectiveTree.savingsRules.map((s: SavingsRule) => savingsToMapItem(s, accountById, ctx)),
    ...effectiveTree.expenses.map((e: Expense) => expenseToMapItem(e, ctx)),
  ];

  // Editor hydration rows — the SAME `effectiveTree` the cards above are built
  // from, run through the house view-adapters (`@/lib/scenario/view-adapters`,
  // the layer that exists so pages read through `loadEffectiveTree` instead of
  // querying base rows). Client-side editors seed from these, never from the
  // base-scoped list-GETs, so a save made while a scenario is active carries
  // that scenario's values rather than clobbering them with base ones.
  //
  // Synthesized life-insurance rows (`source: "policy"` — `premium-<uuid>`
  // expenses from `insurance-policies/premium-expense.ts`, `policy-income-<uuid>`
  // incomes from `policy-income.ts`) are re-derived from the life-insurance
  // accounts on every load and have NO DB row, so neither write path can accept
  // them: the base PUT hits a uuid column and 500s, and the scenario changes
  // route rejects the id outright at `targetId: z.string().uuid()`. They get no
  // hydration entry — which is what makes their cards render non-interactive
  // (see `isItemEditable` in household-map-view.tsx). They deliberately STAY in
  // `items` above: a premium is a real outflow, and dropping it would understate
  // the Cash Flow band subtotal. A visibly non-editable card beats a silently
  // missing one.
  const incomeRows: Record<string, IncomeView> = Object.fromEntries(
    effectiveTree.incomes
      .filter((i: Income) => i.source !== "policy")
      .map((i: Income) => [i.id, incomeEngineToView(i)] as const),
  );
  const expenseRows: Record<string, ExpenseView> = Object.fromEntries(
    effectiveTree.expenses
      .filter((e: Expense) => e.source !== "policy")
      .map((e: Expense) => [e.id, expenseEngineToView(e)] as const),
  );
  const savingsRuleRows: Record<string, SavingsRuleView> = Object.fromEntries(
    effectiveTree.savingsRules.map((s: SavingsRule) => [s.id, savingsRuleEngineToView(s)] as const),
  );
  const accountOptions = effectiveTree.accounts.map(accountEngineToView);

  const goals = buildMapGoals({
    expenses: effectiveTree.expenses,
    milestones,
    client: {
      firstName: effectiveTree.client.firstName,
      retirementAge: client.retirementAge,
      lifeExpectancy: client.lifeExpectancy,
      // `spouseName` is the spouse CRM contact's firstName — the same row whose
      // dateOfBirth gates `milestones.spouseEnd` above. They cannot diverge, so
      // the unguarded `${spouseFirstName}'s life expectancy` title in goals.ts
      // stays safe. Do not source this name from anywhere else.
      spouseFirstName: effectiveTree.client.spouseName ?? null,
      spouseRetirementAge: client.spouseRetirementAge,
      spouseLifeExpectancy: client.spouseLifeExpectancy,
    },
    familyMemberNamesById: ctx.nameByFamilyMemberId,
  });

  // Net worth = assets − debts, the same signs the item list carries.
  const netWorth =
    effectiveTree.accounts.reduce((sum, a) => sum + a.value, 0) -
    effectiveTree.liabilities.reduce((sum, l) => sum + l.balance, 0);

  const today = new Date();
  const spouseFirstName = effectiveTree.client.spouseName ?? null;
  const clientBirthYear = birthYearFromDob(client.dateOfBirth);
  // Same CRM spouse-contact DOB (`client.spouseDob`) that feeds `age` below
  // and gates `milestones.spouseEnd` — must not diverge (see the
  // `spouseFirstName` note near `buildMapGoals` below).
  const spouseBirthYear = birthYearFromDob(client.spouseDob);
  const people = {
    client: {
      familyMemberId: familyMemberRows.find((f) => f.role === "client")?.id ?? null,
      firstName: effectiveTree.client.firstName,
      age: ageOnDate(client.dateOfBirth, today),
      retirementYear: yearForAge(clientBirthYear, client.retirementAge),
      birthYear: clientBirthYear,
    } satisfies MapPerson,
    spouse: spouseFirstName
      ? ({
          familyMemberId: familyMemberRows.find((f) => f.role === "spouse")?.id ?? null,
          firstName: spouseFirstName,
          age: ageOnDate(client.spouseDob, today),
          retirementYear:
            client.spouseRetirementAge == null
              ? null
              : yearForAge(spouseBirthYear, client.spouseRetirementAge),
          birthYear: spouseBirthYear,
        } satisfies MapPerson)
      : null,
    children: familyMemberRows
      .filter((f) => f.role === "child")
      .map((f) => {
        const birthYear = birthYearFromDob(f.dateOfBirth);
        return {
          familyMemberId: f.id,
          firstName: f.firstName,
          age: ageOnDate(f.dateOfBirth, today),
          retirementYear: null,
          birthYear,
        } satisfies MapPerson;
      }),
  };

  return (
    <HouseholdMapView
      clientId={id}
      people={people}
      netWorthLabel={moneyLabel(netWorth)}
      items={items}
      goals={goals}
      canEdit={permission === "edit"}
      incomeRows={incomeRows}
      expenseRows={expenseRows}
      savingsRuleRows={savingsRuleRows}
      accountOptions={accountOptions}
    />
  );
}
