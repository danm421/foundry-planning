import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts, entities, familyMembers, scenarios } from "@/db/schema";
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
  isHydratableExpense,
  isHydratableIncome,
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

  const [entityRows, familyMemberRows, { effectiveTree }] = await Promise.all([
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
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
  ]);

  // Everything the boards, milestones and person nodes read comes from ONE
  // provenance: the scenario-effective tree. Retirement age, plan-end age, life
  // expectancy and both plan-horizon years are all scenario-overridable —
  // `mutations-to-scenario-changes.ts` writes them as `targetKind: "client"` /
  // `planSettings.*`, and `applyChanges.ts` applies both as singletons — so
  // reading them off the raw client row (or off a planSettings query pinned to
  // the BASE scenario id) made a solver "retire at 62" scenario render scenario
  // numbers on the boards while the Goals board's "Alex retires" milestone and
  // the PersonNode still showed the base year.
  //
  // `dateOfBirth` / `spouseDob` deliberately stay on their CRM-contact source
  // (`client`, gated above): identity is not scenario-overridable.
  //
  // No `?? currentYear` fallback on the two horizon years any more: the old
  // query could return zero rows, but `loadEffectiveTree` throws
  // `ProjectionInputError` when a client has no plan_settings row, and both
  // columns are NOT NULL. A fallback here would only mislead a reader into
  // thinking they can be absent.
  const effectiveClient = effectiveTree.client;
  const { planStartYear, planEndYear } = effectiveTree.planSettings;
  const retirementAge = effectiveClient.retirementAge;
  const planEndAge = effectiveClient.planEndAge;
  const lifeExpectancy = effectiveClient.lifeExpectancy ?? client.lifeExpectancy;
  const spouseRetirementAge = effectiveClient.spouseRetirementAge ?? null;
  const spouseLifeExpectancy = effectiveClient.spouseLifeExpectancy ?? null;

  const milestones = buildClientMilestones(
    {
      dateOfBirth: client.dateOfBirth,
      retirementAge,
      planEndAge,
      spouseDob: client.spouseDob,
      spouseRetirementAge,
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
    ...effectiveTree.incomes.map((i: Income) => incomeToMapItem(i, accountById, ctx)),
    ...effectiveTree.savingsRules.map((s: SavingsRule) => savingsToMapItem(s, accountById, ctx)),
    ...effectiveTree.expenses.map((e: Expense) => expenseToMapItem(e, accountById, ctx)),
  ];

  // Editor hydration rows — the SAME `effectiveTree` the cards above are built
  // from, run through the house view-adapters (`@/lib/scenario/view-adapters`,
  // the layer that exists so pages read through `loadEffectiveTree` instead of
  // querying base rows). Client-side editors seed from these, never from the
  // base-scoped list-GETs, so a save made while a scenario is active carries
  // that scenario's values rather than clobbering them with base ones.
  //
  // Two classes of row deliberately get NO hydration entry, and both keep their
  // card — `isHydratableIncome` / `isHydratableExpense` in
  // `@/lib/household-map/map-items` own the rule and document it in full:
  //
  //   1. Synthesized life-insurance rows (`source: "policy"` — `premium-<uuid>`
  //      expenses from `insurance-policies/premium-expense.ts`,
  //      `policy-income-<uuid>` incomes from `policy-income.ts`) have no DB row,
  //      so neither write path can accept them.
  //   2. Social-security incomes. The quick-edit drawer submits a fixed
  //      nine-key body and the scenario changes-writer replaces the change
  //      payload WHOLESALE, so a no-op Save from the Map would delete a
  //      "claim at 70" scenario's edit row outright.
  //
  // Both keep their cards on purpose: a premium is a real outflow and an SS
  // benefit is real income, so dropping either would understate a band
  // subtotal. Missing the hydration entry is what makes those cards render
  // non-interactive (see `isItemEditable` in household-map-view.tsx). A visibly
  // non-editable card beats a silently missing one — or a silently destructive
  // one.
  const incomeRows: Record<string, IncomeView> = Object.fromEntries(
    effectiveTree.incomes
      .filter(isHydratableIncome)
      .map((i: Income) => [i.id, incomeEngineToView(i)] as const),
  );
  const expenseRows: Record<string, ExpenseView> = Object.fromEntries(
    effectiveTree.expenses
      .filter(isHydratableExpense)
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
      firstName: effectiveClient.firstName,
      retirementAge,
      lifeExpectancy,
      // `spouseName` is the spouse CRM contact's firstName — the same row whose
      // dateOfBirth gates `milestones.spouseEnd` above. They cannot diverge, so
      // the unguarded `${spouseFirstName}'s life expectancy` title in goals.ts
      // stays safe. Do not source this name from anywhere else.
      spouseFirstName: effectiveClient.spouseName ?? null,
      spouseRetirementAge,
      spouseLifeExpectancy,
    },
    familyMemberNamesById: ctx.nameByFamilyMemberId,
  });

  // Net worth = assets − debts, the same signs the item list carries.
  const netWorth =
    effectiveTree.accounts.reduce((sum, a) => sum + a.value, 0) -
    effectiveTree.liabilities.reduce((sum, l) => sum + l.balance, 0);

  const today = new Date();
  const spouseFirstName = effectiveClient.spouseName ?? null;
  const clientBirthYear = birthYearFromDob(client.dateOfBirth);
  // Same CRM spouse-contact DOB (`client.spouseDob`) that feeds `age` below
  // and gates `milestones.spouseEnd` — must not diverge (see the
  // `spouseFirstName` note near `buildMapGoals` below).
  const spouseBirthYear = birthYearFromDob(client.spouseDob);
  const people = {
    client: {
      familyMemberId: familyMemberRows.find((f) => f.role === "client")?.id ?? null,
      firstName: effectiveClient.firstName,
      age: ageOnDate(client.dateOfBirth, today),
      retirementYear: yearForAge(clientBirthYear, retirementAge),
      birthYear: clientBirthYear,
    } satisfies MapPerson,
    spouse: spouseFirstName
      ? ({
          familyMemberId: familyMemberRows.find((f) => f.role === "spouse")?.id ?? null,
          firstName: spouseFirstName,
          age: ageOnDate(client.spouseDob, today),
          retirementYear:
            spouseRetirementAge == null
              ? null
              : yearForAge(spouseBirthYear, spouseRetirementAge),
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
