// src/lib/household-map/goals.ts
import { isGoalExpense } from "@/lib/goals";
import { coerceYearRef, resolveMilestone, type ClientMilestones } from "@/lib/milestones";
import { ASSUMED_LIFE_EXPECTANCY } from "@/lib/plan-horizon";
import { isSocialSecurityIncome, ssClaim, ssEstimatedAnnual } from "./social-security";
import type { ClientInfo, Income } from "@/engine/types";

export type GoalKind =
  | "education"
  | "purchase"
  | "household"
  | "retirement"
  | "life_expectancy"
  | "social_security";
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
  /**
   * True when nothing is stored and `age` is the engine's own `?? 95` fallback
   * (`isSpouseLifeExpectancyDefaulted` in `engine/death-event/shared.ts`). The
   * projection really does run to that year, but no one chose it — so the card
   * says "assumed" rather than presenting it as a decision the advisor made.
   */
  assumed: boolean;
}

/**
 * The editable payload of a Social Security milestone card.
 *
 * Present on the two `social_security` milestones and null on every other card.
 * Its presence is what makes the benefit click-to-edit, exactly as
 * `lifeExpectancy` does for the age on a life-expectancy card.
 */
export interface GoalSocialSecurity {
  /** The `incomes` row the inline editor writes. */
  incomeId: string;
  owner: LifeExpectancyOwner;
  /**
   * Which COLUMN the editable figure is, and therefore what an edit writes:
   * `manual_amount` → `annualAmount`, `pia_at_fra` → `piaMonthly`.
   *
   * There is no third member. `no_benefit` rows get no card at all — the engine
   * skips them (`engine/income.ts`), so there is no year to place one at.
   *
   * The PIA is deliberately NOT back-solved from a typed annual benefit. It is a
   * figure off an SSA statement; letting an advisor overwrite it by typing the
   * number the app derived from it would silently rewrite the source document.
   */
  mode: "manual_amount" | "pia_at_fra";
  /** The figure the editor holds: ANNUAL dollars in `manual_amount`, MONTHLY
   *  dollars in `pia_at_fra`. Zero on a freshly seeded row, which is the prompt
   *  to fill it in that `create-client.ts` intends. */
  amount: number;
  /** The resolved claim age as a label — "70", "67y 6mo". Carried rather than
   *  left for the card to parse back out of `detail`, and resolved from the same
   *  `ssClaim` call that fixed the card's YEAR, so the age and the year on a card
   *  cannot describe two different claims. */
  claimAgeLabel: string;
  /**
   * The first-year benefit the PIA implies at this claim age — `pia_at_fra` only,
   * and null when the PIA is unset. Null in `manual_amount` too, where `amount`
   * IS the annual figure and a second copy of it would only invite drift.
   *
   * Own retirement only; see `ssEstimatedAnnual`. Always rendered as an estimate.
   */
  estimatedAnnual: number | null;
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
  /** Set on the two Social Security milestones and null on every other card.
   *  Its presence is what makes the card's benefit click-to-edit. */
  socialSecurity: GoalSocialSecurity | null;
}

/**
 * Re-exported from `lib/plan-horizon`, which is where the horizon derivation
 * that has to agree with it lives. It used to be a second literal here, on the
 * reasoning that this module should stay free of engine imports — but
 * `plan-horizon` is a `lib` module whose only engine reference is an erased
 * `import type`, and the sibling `life-expectancy-write.ts` already imports from
 * it. A local copy bought nothing and could drift from the number the projection
 * actually runs to.
 */
export { ASSUMED_LIFE_EXPECTANCY };

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
  /**
   * Social Security's two milestones. `incomes` is the whole income list — the
   * SS rows are picked out here, so callers don't each re-implement the
   * type test.
   *
   * `clientInfo` is the scenario-effective `client` singleton, which claim-age
   * resolution needs and `client` above cannot supply: `resolveClaimAgeMonths`
   * reads DOB STRINGS (for `fra` mode) and both retirement ages, while `client`
   * carries birth YEARS. Both are derived from the same effective client in
   * `build-boards.ts`, so they cannot disagree about a retirement age.
   */
  socialSecurity: {
    incomes: readonly Income[];
    clientInfo: ClientInfo;
  };
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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
    // Education is always a goal; everything else opts in via `isGoal`. The
    // rule lives in `lib/goals.ts` — the wizard's Goals step asks the same
    // question and the two sets must not drift.
    if (!isGoalExpense(e)) continue;

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
      socialSecurity: null,
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
    socialSecurity: null,
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
      socialSecurity: null,
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
  goals.push(...lifeExpectancyMilestones(input));
  goals.push(...socialSecurityMilestones(input));

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

  // Takes the STORED age (nullable) rather than a resolved age plus an
  // `assumed` flag: the flag is derivable from the same nullable the age comes
  // from, and passing both separately made "assumed: true at an age someone
  // actually chose" representable.
  const card = (
    owner: LifeExpectancyOwner,
    firstName: string,
    birthYear: number,
    storedAge: number | null,
  ): MapGoal => {
    const assumed = storedAge == null;
    const age = storedAge ?? ASSUMED_LIFE_EXPECTANCY;
    return {
      id: `milestone:${owner}_life_expectancy`,
      year: birthYear + age,
      kind: "life_expectancy",
      side: owner,
      title: `${firstName}'s life expectancy`,
      detail: assumed ? `age ${age} · assumed` : `age ${age}`,
      expenseId: null,
      forFamilyMemberName: null,
      lifeExpectancy: { owner, age, assumed },
      socialSecurity: null,
    };
  };

  if (client.birthYear != null) {
    out.push(card("client", client.firstName, client.birthYear, client.lifeExpectancy));
  }

  // Gated on the spouse's NAME + BIRTH YEAR, not on `milestones.spouseEnd`.
  // `buildClientMilestones` only populates the spouse milestones when a spouse
  // retirement age is also set, so keying off them hid the life-expectancy card
  // for a spouse who has a DOB but no retirement age — two unrelated facts.
  if (client.spouseFirstName && client.spouseBirthYear != null) {
    out.push(
      card("spouse", client.spouseFirstName, client.spouseBirthYear, client.spouseLifeExpectancy),
    );
  }

  return out;
}

/** `$2,800/mo` / `$48,000/yr` — the benefit figure, in the units its mode holds. */
function benefitLabel(mode: GoalSocialSecurity["mode"], amount: number): string {
  return mode === "pia_at_fra" ? `${currency.format(amount)}/mo` : `${currency.format(amount)}/yr`;
}

/**
 * One Social Security card per principal who has an SS income row, placed at the
 * first year the projection actually pays the benefit.
 *
 * Every household has these rows: `create-client.ts` seeds one per person at $0
 * with `claimingAge: 67`, precisely so the advisor is prompted to fill the
 * benefit in — which is what makes an editable card on the timeline worth having
 * rather than an empty gesture.
 *
 * A person is skipped when:
 *   • they have no SS row at all;
 *   • the row is `no_benefit` — `engine/income.ts` skips it, so there is no year
 *     at which anything starts;
 *   • `claimingAge` is null. That column, not the mode, is what gates the
 *     engine's claim-age branch (`inc.claimingAge != null` in `engine/income.ts`),
 *     and a row without one is paid from its `startYear` like an ordinary income.
 *     A "starts at 67" card would then name a year the projection never uses.
 *     NOTE the Cash Flow board's timing cell does NOT apply this gate — `ssStartNote`
 *     predates it and still labels such a row "at 67". Pre-existing; left alone
 *     because changing it changes a shipped surface this feature does not touch;
 *   • the claim age or the owner's birth year is underivable (`ssClaim` → null).
 */
function socialSecurityMilestones(input: BuildMapGoalsInput): MapGoal[] {
  const { incomes, clientInfo } = input.socialSecurity;
  const { client } = input;
  const out: MapGoal[] = [];

  const card = (owner: LifeExpectancyOwner, firstName: string): MapGoal | null => {
    // First match wins, matching `SocialSecurityCard.findRow` — a household with
    // two rows for one owner is a legacy edge case, and picking a different one
    // here than the dialog does would let the two edit different rows.
    const row = incomes.find((i) => isSocialSecurityIncome(i) && i.owner === owner);
    if (!row || row.ssBenefitMode === "no_benefit" || row.claimingAge == null) return null;

    const claim = ssClaim(row, clientInfo);
    if (claim == null) return null;

    // A stored NULL means the row predates the mode column; `SocialSecurityCard`
    // and `SocialSecurityDialog` both read an existing row's null as
    // "manual_amount", and this has to agree with them or the card would offer a
    // PIA editor for a row the engine is paying off `annualAmount`.
    const mode: GoalSocialSecurity["mode"] =
      row.ssBenefitMode === "pia_at_fra" ? "pia_at_fra" : "manual_amount";
    const amount =
      mode === "pia_at_fra" ? Number(row.piaMonthly ?? 0) : Number(row.annualAmount ?? 0);
    const estimatedAnnual =
      mode === "pia_at_fra" ? ssEstimatedAnnual(row, clientInfo, claim.claimAgeMonths) : null;

    // The read-only fallback line, for a board rendered without a writer (the
    // client portal's Organizer). It has to carry the same three facts the
    // editable slot does, or a viewer loses the number the card exists for.
    const detail = [
      `age ${claim.ageLabel}`,
      mode === "pia_at_fra" && amount <= 0 ? "PIA not set" : benefitLabel(mode, amount),
      mode === "pia_at_fra" && estimatedAnnual != null
        ? `est. ${currency.format(estimatedAnnual)}/yr`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      id: `milestone:${owner}_social_security`,
      year: claim.firstBenefitYear,
      kind: "social_security",
      side: owner,
      title: `${firstName} claims Social Security`,
      detail,
      expenseId: null,
      forFamilyMemberName: null,
      lifeExpectancy: null,
      socialSecurity: {
        incomeId: row.id,
        owner,
        mode,
        amount,
        claimAgeLabel: claim.ageLabel,
        estimatedAnnual,
      },
    };
  };

  const clientCard = card("client", client.firstName);
  if (clientCard) out.push(clientCard);

  if (client.spouseFirstName) {
    const spouseCard = card("spouse", client.spouseFirstName);
    if (spouseCard) out.push(spouseCard);
  }

  return out;
}
