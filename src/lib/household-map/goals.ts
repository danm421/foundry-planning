// src/lib/household-map/goals.ts
import { coerceYearRef, resolveMilestone, type ClientMilestones } from "@/lib/milestones";

export type GoalKind =
  | "education"
  | "purchase"
  | "household"
  | "retirement"
  | "life_expectancy";
export type GoalSide = "client" | "spouse" | "joint";

/** Whose life expectancy a card edits. Mirrors the two `clients` columns —
 *  `lifeExpectancy` and `spouseLifeExpectancy`. */
export type LifeExpectancyOwner = "client" | "spouse";

/** The editable payload of a life-expectancy milestone card. */
export interface GoalLifeExpectancy {
  owner: LifeExpectancyOwner;
  /** The age the projection actually uses — the stored column, or the engine's
   *  fallback when `assumed`. */
  age: number;
  /** Calendar year this person reaches `age`; the card's spine year. */
  year: number;
  /**
   * True when nothing is stored and `age` is the engine's own `?? 95` fallback
   * (`isSpouseLifeExpectancyDefaulted` in `engine/death-event/shared.ts`). The
   * projection really does run to that year, but no one chose it — so the card
   * says "assumed" rather than presenting it as a decision the advisor made.
   */
  assumed: boolean;
}

export interface MapGoal {
  /** Stable id: `expense:<uuid>` or `milestone:<slug>`. */
  id: string;
  year: number;
  kind: GoalKind;
  side: GoalSide;
  title: string;
  /** One-line supporting figure, e.g. "$38,000/yr · 2029–2032". */
  detail: string | null;
  /** The expense this card edits. Null for life milestones. */
  expenseId: string | null;
  forFamilyMemberName: string | null;
  /**
   * Set on the two life-expectancy milestones and null on every other card
   * (including the retirement milestones, which are not editable from this
   * board). Its presence is what makes the card's age click-to-edit.
   */
  lifeExpectancy: GoalLifeExpectancy | null;
}

/**
 * The age the engine assumes for a spouse with a DOB but no stored life
 * expectancy — `spouseLifeExpectancy ?? 95` in `computeFinalDeathYear` and
 * `planHorizonFromLifeExpectancy`. Duplicated here rather than imported so this
 * module stays free of engine imports; the three must not drift.
 */
export const ASSUMED_LIFE_EXPECTANCY = 95;

/** The subset of an engine Expense the Goals board needs. */
export interface GoalExpense {
  id: string;
  type: "living" | "other" | "insurance" | "education";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  startYearRef?: string | null;
  endYearRef?: string | null;
  isGoal?: boolean;
  forFamilyMemberId?: string | null;
  institutionName?: string | null;
}

export interface BuildMapGoalsInput {
  expenses: GoalExpense[];
  milestones: ClientMilestones;
  client: {
    firstName: string;
    retirementAge: number;
    lifeExpectancy: number;
    /**
     * Calendar year of birth, sliced from the DOB (`birthYearFromDob`). Required
     * for the life-expectancy milestone, whose year is `birthYear + lifeExpectancy`
     * — the engine's own per-person death-year rule. Null (an unparseable DOB)
     * drops that card rather than guessing a year.
     */
    birthYear: number | null;
    spouseFirstName: string | null;
    spouseRetirementAge: number | null;
    spouseLifeExpectancy: number | null;
    spouseBirthYear: number | null;
  };
  familyMemberNamesById: ReadonlyMap<string, string>;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Education is always a goal; everything else opts in via the isGoal flag. */
function isGoalRow(e: GoalExpense): boolean {
  return e.type === "education" || e.isGoal === true;
}

function kindOf(e: GoalExpense): GoalKind {
  if (e.type === "education") return "education";
  if (e.type === "other") return "purchase";
  return "household";
}

/** A goal's side follows its beneficiary when there is one, else the household. */
function sideOf(e: GoalExpense, input: BuildMapGoalsInput): GoalSide {
  if (!e.forFamilyMemberId) return "joint";
  // The beneficiary is usually a child; a child's goals hang on whichever
  // principal isn't the plan owner is arbitrary, so keep them joint. Only a
  // goal explicitly for a principal takes a side.
  const name = input.familyMemberNamesById.get(e.forFamilyMemberId);
  if (name && name === input.client.firstName) return "client";
  if (name && input.client.spouseFirstName && name === input.client.spouseFirstName) {
    return "spouse";
  }
  return "joint";
}

function detailOf(e: GoalExpense, year: number, endYear: number): string {
  const amount = currency.format(e.annualAmount);
  const span = endYear > year ? `${year}–${endYear}` : `${year}`;
  const perYear = endYear > year ? `${amount}/yr` : amount;
  return `${perYear} · ${span}`;
}

/**
 * Build the Goals board's cards from three sources:
 *   1. expenses flagged `isGoal`
 *   2. every education expense, flag or not
 *   3. the three life milestones (client retirement, spouse retirement, plan end)
 *
 * Years come from `resolveMilestone` when the row is milestone-anchored, so a
 * goal pinned to "at retirement" moves when the retirement age moves.
 *
 * Pure. No IO.
 */
export function buildMapGoals(input: BuildMapGoalsInput): MapGoal[] {
  const { milestones: m, client } = input;
  const goals: MapGoal[] = [];

  // --- 1 & 2: expense-backed goals ---
  for (const e of input.expenses) {
    if (!isGoalRow(e)) continue;

    const startRef = coerceYearRef(e.startYearRef);
    const endRef = coerceYearRef(e.endYearRef);
    const year = (startRef && resolveMilestone(startRef, m, "start")) ?? e.startYear;
    const endYear = (endRef && resolveMilestone(endRef, m, "end")) ?? e.endYear;

    goals.push({
      id: `expense:${e.id}`,
      year,
      kind: kindOf(e),
      side: sideOf(e, input),
      title: e.institutionName ? `${e.name} · ${e.institutionName}` : e.name,
      detail: detailOf(e, year, endYear),
      expenseId: e.id,
      forFamilyMemberName: e.forFamilyMemberId
        ? (input.familyMemberNamesById.get(e.forFamilyMemberId) ?? null)
        : null,
      lifeExpectancy: null,
    });
  }

  // --- 3: life milestones ---
  goals.push({
    id: "milestone:client_retirement",
    year: m.clientRetirement,
    kind: "retirement",
    side: "client",
    title: `${client.firstName} retires`,
    detail: `age ${client.retirementAge}`,
    expenseId: null,
    forFamilyMemberName: null,
    lifeExpectancy: null,
  });

  if (m.spouseRetirement != null && client.spouseFirstName && client.spouseRetirementAge != null) {
    goals.push({
      id: "milestone:spouse_retirement",
      year: m.spouseRetirement,
      kind: "retirement",
      side: "spouse",
      title: `${client.spouseFirstName} retires`,
      detail: `age ${client.spouseRetirementAge}`,
      expenseId: null,
      forFamilyMemberName: null,
      lifeExpectancy: null,
    });
  }

  // ONE CARD PER PERSON. The board previously emitted a single "plan end" card
  // for the LATER of the two deaths, so the first-to-die spouse never appeared
  // on the timeline at all — which is the whole point of a two-sided spine.
  //
  // Its years were wrong too, and worth spelling out so nobody reinstates them:
  // both came from `milestones`, which derives BOTH ends from the household-wide
  // `planEndAge` (`clients.plan_end_age` = "the last death, in the primary's
  // years"). So `m.clientEnd` is the year the last spouse dies — the client's own
  // death year only when the client outlives — and `m.spouseEnd` is
  // `spouseBirthYear + planEndAge`, a number with no meaning whatsoever. The
  // card's AGE detail meanwhile came from that person's real `lifeExpectancy`, so
  // year and age disagreed for every household where the client is not the last
  // to die.
  //
  // Both cards now use the engine's own per-person rule, `birthYear +
  // lifeExpectancy` (`computeFinalDeathYear`, `engine/death-event/shared.ts`),
  // which is what the projection actually keys death events off. Do not route
  // these back through `milestones`.
  for (const le of lifeExpectancyMilestones(input)) {
    goals.push(le);
  }

  return goals.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
}

/**
 * One life-expectancy card per living principal. A person is skipped only when
 * their birth year is unknown — there is then no year to place the card at, and
 * inventing one would put a death event on the spine that the engine does not
 * project.
 *
 * The spouse's card uses the engine's `?? 95` fallback when no spouse life
 * expectancy is stored, flagged `assumed`. That is not a default we are choosing
 * here: the projection is ALREADY running to that year (see
 * `isSpouseLifeExpectancyDefaulted`), and showing it is how an advisor discovers
 * they never set one.
 */
function lifeExpectancyMilestones(input: BuildMapGoalsInput): MapGoal[] {
  const { client } = input;
  const out: MapGoal[] = [];

  const card = (
    owner: LifeExpectancyOwner,
    firstName: string,
    birthYear: number,
    age: number,
    assumed: boolean,
  ): MapGoal => ({
    id: `milestone:${owner}_life_expectancy`,
    year: birthYear + age,
    kind: "life_expectancy",
    side: owner,
    title: `${firstName}'s life expectancy`,
    detail: assumed ? `age ${age} · assumed` : `age ${age}`,
    expenseId: null,
    forFamilyMemberName: null,
    lifeExpectancy: { owner, age, year: birthYear + age, assumed },
  });

  if (client.birthYear != null) {
    out.push(card("client", client.firstName, client.birthYear, client.lifeExpectancy, false));
  }

  // Gated on the spouse's NAME + BIRTH YEAR, not on `milestones.spouseEnd`.
  // `buildClientMilestones` only populates the spouse milestones when a spouse
  // retirement age is also set, so keying off them hid the life-expectancy card
  // for a spouse who has a DOB but no retirement age — two unrelated facts.
  if (client.spouseFirstName && client.spouseBirthYear != null) {
    out.push(
      card(
        "spouse",
        client.spouseFirstName,
        client.spouseBirthYear,
        client.spouseLifeExpectancy ?? ASSUMED_LIFE_EXPECTANCY,
        client.spouseLifeExpectancy == null,
      ),
    );
  }

  return out;
}
