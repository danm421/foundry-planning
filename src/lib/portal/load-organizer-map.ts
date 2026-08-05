// src/lib/portal/load-organizer-map.ts
//
// Server loader for the Organizer's Goals and Cash Flow tabs. One loader, not
// two: both boards need the same effective tree and the same `people`, so
// splitting it would write the derivation twice and let the two tabs disagree.
//
// The tree is resolved with the literal "base" — the portal has no scenario
// concept and must never render one. `buildMapBoards` is the SAME builder the
// advisor Household Map calls, which is what keeps a card meaning the same
// thing on both surfaces.
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, entities, familyMembers, scenarios } from "@/db/schema";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { buildMapBoards, type MapBoards } from "@/lib/household-map/build-boards";
import type { MapItem } from "@/lib/household-map/types";
import { birthYearFromDob } from "@/lib/age-year";
import { approximateMilestones } from "@/lib/household-map/approximate-milestones";
import {
  expenseEngineToView,
  incomeEngineToView,
  savingsRuleEngineToView,
  type ExpenseView,
  type IncomeView,
  type SavingsRuleView,
} from "@/lib/scenario/view-adapters";
import {
  isPortalVisibleAccount,
  toPortalAccountVisibility,
  type PortalAccountVisibility,
} from "./account-visibility";
import {
  isPortalWritableExpense,
  isPortalWritableIncome,
  isPortalWritableSavingsRule,
} from "./portal-flow-writable";
import type { ClientMilestones } from "@/lib/milestones";

/**
 * The three `kind`s `CashFlowBoard` draws — its `BANDS` in
 * `components/household-map/cash-flow-board.tsx` and nothing else. `buildMapBoards`
 * also emits `account` and `liability` items for the Net Worth board, which the
 * Cash Flow board silently drops at render.
 *
 * The filter lives HERE, in the server loader, rather than in
 * `organizer-cash-flow-screen.tsx`, because this is a disclosure boundary and not
 * a rendering detail: the screen is a server component handing `items` to a
 * `"use client"` board, so EVERY item is serialized into the RSC Flight payload
 * the client's browser receives whether or not the board renders it. Account and
 * liability cards carry the name and value of rows the portal deliberately hides
 * from clients — the advisor-only categories, engine `isDefaultChecking` cash
 * buckets and business sub-accounts named in `./account-visibility.ts`, the single
 * source of truth for what a client may see. Dropping them at render would ship
 * them anyway.
 */
const CASH_FLOW_KINDS: readonly MapItem["kind"][] = ["income", "savings", "expense"];

export interface OrganizerMapData {
  // All three aliased off the builder rather than restated: each value is
  // destructured into a variable before the return, so excess-property checking
  // does not apply and a field added to one of these shapes would be carried at
  // runtime while being silently absent from this type.
  people: MapBoards["people"];
  /** Flow rows only — see `CASH_FLOW_KINDS`. Never accounts or liabilities. */
  items: MapBoards["items"];
  goals: MapBoards["goals"];
  canEdit: boolean;
  /**
   * Editor hydration rows, filtered by the PORTAL writability predicates in
   * `./portal-flow-writable`. Membership is the writability probe: the client
   * components ask `item.id in incomeRows` exactly the way the advisor Map's
   * `isItemEditable` does. A row omitted here keeps its CARD and keeps counting
   * toward the band subtotal — it simply renders inert.
   */
  incomeRows: Record<string, IncomeView>;
  expenseRows: Record<string, ExpenseView>;
  savingsRuleRows: Record<string, SavingsRuleView>;
  /** Savings targets. Portal-visible accounts only — the same gate the portal
   *  Accounts list applies, so a client cannot fund an account they cannot see. */
  savingsAccountOptions: { id: string; name: string }[];
  /** Beneficiary options for an education goal. `birthYear` drives the goal's
   *  auto-fill and is nullable — a member with no DOB just doesn't move the dates. */
  familyMemberOptions: { id: string; firstName: string; birthYear: number | null }[];
  /** Seeds the Start/End year pickers. Approximate by design — see
   *  `approximateMilestones`. */
  milestones: ClientMilestones;
  /** Display-only hint for the growth line. The engine re-resolves the effective
   *  rate at load time; a hard-coded 3% told clients on a 2.4% plan the wrong number. */
  resolvedInflationRate: number;
}

/**
 * Null when the household cannot produce a board at all — no base-case scenario,
 * or no primary CRM contact date of birth. Both are real states for a
 * half-onboarded client, and an empty board would read as "you have no goals"
 * rather than "your advisor hasn't finished setting this up".
 */
export async function loadOrganizerMap(clientId: string): Promise<OrganizerMapData | null> {
  const [client] = await db
    .select({
      firmId: clients.firmId,
      crmHouseholdId: clients.crmHouseholdId,
      lifeExpectancy: clients.lifeExpectancy,
      portalEditEnabled: clients.portalEditEnabled,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const [[scenario], contactRows, familyMemberRows, entityRows] = await Promise.all([
    db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
      .limit(1),
    db
      .select({
        role: crmHouseholdContacts.role,
        dateOfBirth: crmHouseholdContacts.dateOfBirth,
      })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId)),
    db
      .select({
        id: familyMembers.id,
        role: familyMembers.role,
        firstName: familyMembers.firstName,
        dateOfBirth: familyMembers.dateOfBirth,
      })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId))
      .orderBy(asc(familyMembers.role), asc(familyMembers.firstName)),
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.clientId, clientId))
      .orderBy(asc(entities.name)),
  ]);
  if (!scenario) return null;

  // CRM contacts are the sole source of DOB for milestone math, exactly as in
  // the advisor Map. No primary DOB means no derivable life-expectancy
  // milestone and no ages on the person nodes.
  const primaryDob = contactRows.find((c) => c.role === "primary")?.dateOfBirth ?? null;
  if (!primaryDob) return null;
  const spouseDob = contactRows.find((c) => c.role === "spouse")?.dateOfBirth ?? null;

  const { effectiveTree } = await loadEffectiveTree(clientId, client.firmId, "base", {});

  // One clock read for the whole load: `buildMapBoards`'s ages and
  // `approximateMilestones`'s current-year anchor must agree on "now", and two
  // independent `new Date()` calls could straddle a year rollover (rare, but a
  // free thing to rule out).
  const now = new Date();

  const { people, items, goals } = buildMapBoards({
    effectiveTree,
    identity: {
      dateOfBirth: primaryDob,
      spouseDob,
      lifeExpectancy: client.lifeExpectancy,
    },
    familyMemberRows,
    entityRows,
    today: now,
  });

  // One pass over the tree's accounts builds both the savings-rule visibility
  // gate AND the savings-target options list, rather than filtering/recomputing
  // the same `PortalAccountVisibility` projection over the array twice.
  const accountVisibilityById = new Map<string, PortalAccountVisibility>();
  const savingsAccountOptions: { id: string; name: string }[] = [];
  for (const a of effectiveTree.accounts) {
    const visibility = toPortalAccountVisibility(a);
    accountVisibilityById.set(a.id, visibility);
    if (isPortalVisibleAccount(visibility)) savingsAccountOptions.push({ id: a.id, name: a.name });
  }

  const incomeRows: Record<string, IncomeView> = Object.fromEntries(
    effectiveTree.incomes
      .filter(isPortalWritableIncome)
      .map((i) => [i.id, incomeEngineToView(i)] as const),
  );
  const expenseRows: Record<string, ExpenseView> = Object.fromEntries(
    effectiveTree.expenses
      .filter(isPortalWritableExpense)
      .map((e) => [e.id, expenseEngineToView(e)] as const),
  );
  const savingsRuleRows: Record<string, SavingsRuleView> = Object.fromEntries(
    effectiveTree.savingsRules
      .filter((s) => isPortalWritableSavingsRule(s, accountVisibilityById))
      .map((s) => [s.id, savingsRuleEngineToView(s)] as const),
  );

  return {
    people,
    items: items.filter((i) => CASH_FLOW_KINDS.includes(i.kind)),
    goals,
    canEdit: client.portalEditEnabled,
    incomeRows,
    expenseRows,
    savingsRuleRows,
    savingsAccountOptions,
    familyMemberOptions: familyMemberRows.map(({ id, firstName, dateOfBirth }) => ({
      id,
      firstName,
      birthYear: birthYearFromDob(dateOfBirth),
    })),
    milestones: approximateMilestones(people, goals, now.getFullYear()),
    resolvedInflationRate: effectiveTree.planSettings.inflationRate,
  };
}
