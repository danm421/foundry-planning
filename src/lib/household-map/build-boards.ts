// src/lib/household-map/build-boards.ts
//
// The one place an effective tree becomes board data. Both the advisor
// Household Map (`details/map/map-content.tsx`) and the client portal Organizer
// (`lib/portal/load-organizer-map.ts`) call this, so a card can never mean one
// thing on one surface and something else on the other.
//
// Pure: no DB, no React, no `new Date()`. The caller passes `today` so ages are
// reproducible in tests and cannot drift a Jan-1 DOB across timezones.
import { withDerivedEquityValues } from "@/lib/accounts/equity-derived-values";
import { ageOnDate, birthYearFromDob, yearForAge } from "@/lib/age-year";
import { buildClientMilestones } from "@/lib/milestones";
import { buildMapGoals, type MapGoal } from "./goals";
import {
  ACCOUNT_CATEGORY,
  expenseToMapItem,
  incomeToMapItem,
  savingsToMapItem,
  toMapItem,
} from "./map-items";
import { ssStartNote } from "./social-security";
import type { ColumnContext, MapItem, MapPeople, MapPerson } from "./types";
import type {
  Account,
  ClientData,
  Expense,
  Income,
  Liability,
  SavingsRule,
} from "@/engine/types";

export interface MapBoardsInput {
  effectiveTree: ClientData;
  identity: { dateOfBirth: string; spouseDob: string | null; lifeExpectancy: number };
  familyMemberRows: readonly {
    id: string;
    role: "client" | "spouse" | "child" | "other";
    firstName: string;
    dateOfBirth: string | null;
  }[];
  entityRows: readonly { id: string; name: string }[];
  today: Date;
}

export interface MapBoards {
  people: MapPeople;
  items: MapItem[];
  goals: MapGoal[];
  netWorth: number;
}

export function buildMapBoards(input: MapBoardsInput): MapBoards {
  const { effectiveTree, identity, familyMemberRows, entityRows, today } = input;

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
  // (`identity`, gated by the caller): identity is not scenario-overridable.
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
  const lifeExpectancy = effectiveClient.lifeExpectancy ?? identity.lifeExpectancy;
  const spouseRetirementAge = effectiveClient.spouseRetirementAge ?? null;
  const spouseLifeExpectancy = effectiveClient.spouseLifeExpectancy ?? null;

  const milestones = buildClientMilestones(
    {
      dateOfBirth: identity.dateOfBirth,
      retirementAge,
      planEndAge,
      spouseDob: identity.spouseDob,
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

  // Every account read below comes from HERE, not from `effectiveTree.accounts`
  // — a stock_options account's stored value is a permanent "0" and its real
  // balance lives in the grants. Substituting once, above the item list, the
  // net-worth sum and the lookup map together, is what stops the three from
  // disagreeing about what a position is worth.
  const accounts = withDerivedEquityValues(
    effectiveTree.accounts,
    effectiveTree.stockOptionPlans,
    planStartYear,
  );

  const accountById = new Map<string, Account>(accounts.map((a) => [a.id, a]));

  const items: MapItem[] = [
    ...accounts.map((a: Account) =>
      toMapItem(a, "account", ACCOUNT_CATEGORY[a.category], a.value, ctx),
    ),
    ...effectiveTree.liabilities.map((l: Liability) =>
      toMapItem(l, "liability", "debt", -l.balance, ctx),
    ),
    // The 4th argument is Social Security's timing label. Every other income
    // gets null and keeps its year range; an SS row's persisted years are inert,
    // so an unclaimed benefit's card names the CLAIM AGE instead — see
    // `ssStartNote`. Keyed off `planStartYear`, never the wall clock.
    ...effectiveTree.incomes.map((i: Income) =>
      incomeToMapItem(i, accountById, ctx, ssStartNote(i, effectiveClient, planStartYear)),
    ),
    ...effectiveTree.savingsRules.map((s: SavingsRule) => savingsToMapItem(s, accountById, ctx)),
    ...effectiveTree.expenses.map((e: Expense) => expenseToMapItem(e, accountById, ctx)),
  ];

  // Birth years, from the CRM-contact DOBs the caller passes in `identity`.
  // Declared here rather than beside `people` below because `buildMapGoals` needs
  // them too: each life-expectancy milestone sits at `birthYear + lifeExpectancy`,
  // the engine's own per-person death-year rule. Both consumers must read the
  // same value — a card whose year disagreed with the person node's age is the
  // bug this replaced.
  const clientBirthYear = birthYearFromDob(identity.dateOfBirth);
  // Same CRM spouse-contact DOB (`identity.spouseDob`) that feeds `age` below
  // and gates `milestones.spouseEnd` — must not diverge (see the
  // `spouseFirstName` note in `buildMapGoals` below).
  const spouseBirthYear = birthYearFromDob(identity.spouseDob);
  const spouseFirstName = effectiveClient.spouseName ?? null;

  const goals = buildMapGoals({
    expenses: effectiveTree.expenses,
    milestones,
    client: {
      firstName: effectiveClient.firstName,
      retirementAge,
      lifeExpectancy,
      birthYear: clientBirthYear,
      // `spouseName` is the spouse CRM contact's firstName — the same row whose
      // dateOfBirth gates `milestones.spouseEnd` above. They cannot diverge, so
      // the unguarded `${spouseFirstName}'s life expectancy` title in goals.ts
      // stays safe. Do not source this name from anywhere else.
      spouseFirstName,
      spouseRetirementAge,
      spouseLifeExpectancy,
      spouseBirthYear,
    },
    familyMemberNamesById: ctx.nameByFamilyMemberId,
    // The SAME effective client the milestones and person nodes above read, so
    // a solver "retire at 62" scenario resolves an `at_retirement` claim age to
    // 62 on the Goals board's Social Security card exactly as `ssStartNote`
    // already does on the Cash Flow board's timing cell.
    socialSecurity: { incomes: effectiveTree.incomes, clientInfo: effectiveClient },
  });

  // Net worth = assets − debts, the same signs the item list carries — and off
  // the SAME derived `accounts` the cards are drawn from, so the total can
  // never disagree with the cards that make it up.
  const netWorth =
    accounts.reduce((sum, a) => sum + a.value, 0) -
    effectiveTree.liabilities.reduce((sum, l) => sum + l.balance, 0);

  const people = {
    client: {
      familyMemberId: familyMemberRows.find((f) => f.role === "client")?.id ?? null,
      firstName: effectiveClient.firstName,
      age: ageOnDate(identity.dateOfBirth, today),
      retirementYear: yearForAge(clientBirthYear, retirementAge),
      birthYear: clientBirthYear,
    } satisfies MapPerson,
    spouse: spouseFirstName
      ? ({
          familyMemberId: familyMemberRows.find((f) => f.role === "spouse")?.id ?? null,
          firstName: spouseFirstName,
          age: ageOnDate(identity.spouseDob, today),
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

  // `ctx` and `milestones` stay LOCAL. Both are inputs to `items` and `goals`
  // above, and neither has ever had a consumer on the far side of this return —
  // returning them would only invite a second, divergent derivation.
  return { people, items, goals, netWorth };
}
