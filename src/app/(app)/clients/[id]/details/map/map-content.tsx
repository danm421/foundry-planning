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
import { formatCurrency } from "@/lib/cell-drill/format";
import { buildClientMilestones } from "@/lib/milestones";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { assignColumn } from "@/lib/household-map/columns";
import { buildMapGoals } from "@/lib/household-map/goals";
import { moneyLabel } from "@/lib/household-map/format";
import type {
  ColumnAssignment,
  ColumnContext,
  MapColumn,
  MapItem,
  MapPerson,
} from "@/lib/household-map/types";
import type { Account, Expense, Income, Liability, SavingsRule } from "@/engine/types";
import HouseholdMapView from "@/components/household-map/household-map-view";

// ──────────────────────────────────────────────────────────────────────────
// Display adapters. Page-shaped, not domain logic: they turn engine rows into
// the flat `MapItem` the boards render. Column placement is the one piece of
// real logic and it lives in `@/lib/household-map/columns`.
// ──────────────────────────────────────────────────────────────────────────

/** Account category → the board's visual category (drives the card's hue). */
const ACCOUNT_CATEGORY: Record<Account["category"], MapItem["category"]> = {
  taxable: "investments",
  cash: "investments",
  retirement: "investments",
  education_savings: "investments",
  notes_receivable: "investments",
  stock_options: "investments",
  annuity: "investments",
  real_estate: "property",
  business: "property",
  life_insurance: "insurance",
};

/** Accounts and liabilities both carry `owners[]`, so both place via
 *  `assignColumn`. The caller supplies the signed value and the hue because
 *  those are the only two things that differ between them. */
function toMapItem(
  thing: { id: string; name: string; owners: Account["owners"] },
  kind: "account" | "liability",
  category: MapItem["category"],
  value: number,
  ctx: ColumnContext,
): MapItem {
  return {
    id: thing.id,
    kind,
    category,
    name: thing.name,
    value,
    valueLabel: moneyLabel(value),
    ...assignColumn(thing, ctx),
    noteChip: null,
  };
}

/**
 * Incomes and expenses have no `owners[]` — ownership is a single enum (income)
 * or implicitly the household (expense), plus an optional owning entity. An
 * entity-owned flow trays for the same reason `assignColumn` trays an
 * entity-owned asset: the board has no honest way to draw it in a principal's
 * column.
 */
function flowAssignment(
  ownerEntityId: string | undefined,
  householdColumn: MapColumn,
  ctx: ColumnContext,
): ColumnAssignment {
  if (ownerEntityId) {
    return {
      column: "tray",
      splitChip: null,
      trayOwnerLabel: ctx.nameByEntityId.get(ownerEntityId) ?? "Entity-owned",
    };
  }
  return { column: householdColumn, splitChip: null, trayOwnerLabel: null };
}

function incomeToMapItem(income: Income, ctx: ColumnContext): MapItem {
  return {
    id: income.id,
    kind: "income",
    category: "investments",
    name: income.name,
    value: income.annualAmount,
    valueLabel: moneyLabel(income.annualAmount),
    ...flowAssignment(income.ownerEntityId, income.owner, ctx),
    noteChip: null,
  };
}

/**
 * `value` and `valueLabel` MUST come from the same branch — a card that shows
 * one number while the engine subtotals another is the bug this fixes.
 *
 * Mirrors the engine's own resolution order (engine/projection.ts's
 * resolvedByRuleId loop → engine/savings.ts resolveContributionAmount):
 * scheduleOverrides[year] first, then contributeMax (IRS limit), then
 * percent-of-pay, then flat annualAmount. Only the flat-dollar branch is
 * resolvable here — contributeMax needs the owner's age + resolved IRS
 * params, and percent-mode needs the owner's salary slice, and both of those
 * live in the projection, not this page-shaped adapter. (scheduleOverrides is
 * the same class of gap and is tracked separately, not fixed here.)
 *
 * So: contributeMax / percent-of-pay rules show the RULE as the label and
 * contribute a literal `0` to subtotals — a card that shows a rule must not
 * add a dollar figure the engine will overrule. Only the flat-dollar branch
 * (the one case fully resolvable without the projection) contributes a real
 * number, and since savings is an outflow it is negative, exactly like
 * expenseToMapItem's outflows, so `items.reduce((s, i) => s + i.value, 0)`
 * nets out correctly without any kind-specific special-casing by callers.
 */
function resolveSavings(rule: SavingsRule): { value: number; valueLabel: string } {
  if (rule.contributeMax) return { value: 0, valueLabel: "IRS max" };
  if (rule.annualPercent != null && rule.annualPercent > 0) {
    return { value: 0, valueLabel: `${Math.round(rule.annualPercent * 100)}% of pay` };
  }
  const value = -rule.annualAmount;
  return { value, valueLabel: moneyLabel(value) };
}

function savingsNoteChip(rule: SavingsRule): string | null {
  if (rule.employerMatchAmount != null) return `${formatCurrency(rule.employerMatchAmount)} match`;
  if (rule.employerMatchPct != null) return `${Math.round(rule.employerMatchPct * 100)}% match`;
  return null;
}

/** A savings rule inherits the column of the account it funds. */
function savingsToMapItem(
  rule: SavingsRule,
  accountById: ReadonlyMap<string, Account>,
  ctx: ColumnContext,
): MapItem {
  const account = accountById.get(rule.accountId);
  const { value, valueLabel } = resolveSavings(rule);
  return {
    id: rule.id,
    kind: "savings",
    category: "investments",
    name: account?.name ?? "Contribution",
    value,
    valueLabel,
    ...assignColumn(account ?? { owners: [] }, ctx),
    noteChip: savingsNoteChip(rule),
  };
}

/** Expenses are household-level: they land in `joint` unless an entity pays
 *  them. Outflows carry a negative `value` so board subtotals net out. */
function expenseToMapItem(expense: Expense, ctx: ColumnContext): MapItem {
  const value = -expense.annualAmount;
  const forName = expense.forFamilyMemberId
    ? ctx.nameByFamilyMemberId.get(expense.forFamilyMemberId)
    : undefined;
  return {
    id: expense.id,
    kind: "expense",
    category: expense.type === "insurance" ? "insurance" : "debt",
    name: expense.name,
    value,
    valueLabel: moneyLabel(value),
    ...flowAssignment(expense.ownerEntityId, "joint", ctx),
    noteChip: forName ? `for ${forName}` : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────

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
    />
  );
}
