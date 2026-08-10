// src/lib/household-map/__tests__/goals.test.ts
import { describe, it, expect } from "vitest";
import { ASSUMED_LIFE_EXPECTANCY, buildMapGoals } from "../goals";
import type { BuildMapGoalsInput } from "../goals";
import type { ClientInfo, Income } from "@/engine/types";

/** The scenario-effective client the SS cards resolve their claim ages against.
 *  DOBs agree with `base.client`'s birth years — Dan 1972, Amy 1974. */
const CLIENT_INFO: ClientInfo = {
  firstName: "Dan",
  lastName: "Reid",
  dateOfBirth: "1972-05-10",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Amy",
  spouseDob: "1974-08-22",
  spouseRetirementAge: 65,
  filingStatus: "married_joint",
};

const ssIncome = (over: Partial<Income> = {}): Income =>
  ({
    id: "ss-client",
    type: "social_security",
    name: "Social Security — Dan",
    annualAmount: 48000,
    startYear: 2026,
    endYear: 2099,
    growthRate: 0.02,
    owner: "client",
    ssBenefitMode: "manual_amount",
    claimingAgeMode: "years",
    claimingAge: 67,
    claimingAgeMonths: 0,
    ...over,
  }) as Income;

const milestones = {
  planStart: 2026,
  planEnd: 2064,
  clientRetirement: 2037,
  clientEnd: 2064,
  spouseRetirement: 2039,
  spouseEnd: 2062,
};

const base: BuildMapGoalsInput = {
  expenses: [],
  milestones,
  client: {
    firstName: "Dan",
    retirementAge: 65,
    lifeExpectancy: 92,
    // Dan 1972 + 92 -> dies 2064. Amy 1974 + 90 -> dies 2064 too, but the two
    // are computed independently now, so a test that moves one must not move
    // the other.
    birthYear: 1972,
    spouseFirstName: "Amy",
    spouseRetirementAge: 65,
    spouseLifeExpectancy: 90,
    spouseBirthYear: 1974,
  },
  familyMemberNamesById: new Map([["fm-kelly", "Kelly"]]),
  // No SS rows by default — the milestone tests opt in, so every other
  // assertion below keeps describing the card set it was written against.
  socialSecurity: { incomes: [], clientInfo: CLIENT_INFO },
};

const expense = (over: Partial<BuildMapGoalsInput["expenses"][number]> = {}) => ({
  id: "exp-1",
  type: "other" as const,
  name: "Kitchen Remodel",
  annualAmount: 60000,
  startYear: 2033,
  endYear: 2033,
  startYearRef: null,
  endYearRef: null,
  isGoal: false,
  forFamilyMemberId: null,
  institutionName: null,
  ...over,
});

function ids(input: BuildMapGoalsInput) {
  return buildMapGoals(input).map((g) => g.id);
}

describe("buildMapGoals", () => {
  it("emits FOUR life milestones for a married household — a life expectancy for EACH spouse", () => {
    expect(ids(base)).toEqual([
      "milestone:client_retirement",
      "milestone:spouse_retirement",
      "milestone:client_life_expectancy",
      "milestone:spouse_life_expectancy",
    ]);
  });

  it("omits the spouse milestones when unmarried", () => {
    const solo: BuildMapGoalsInput = {
      ...base,
      milestones: { ...milestones, spouseRetirement: undefined, spouseEnd: undefined },
      client: {
        ...base.client,
        spouseFirstName: null,
        spouseRetirementAge: null,
        spouseLifeExpectancy: null,
        spouseBirthYear: null,
      },
    };
    expect(ids(solo)).toEqual([
      "milestone:client_retirement",
      "milestone:client_life_expectancy",
    ]);
  });

  it("includes an expense flagged isGoal", () => {
    const r = ids({ ...base, expenses: [expense({ isGoal: true })] });
    expect(r).toContain("expense:exp-1");
  });

  it("excludes an unflagged non-education expense", () => {
    const r = ids({ ...base, expenses: [expense({ isGoal: false })] });
    expect(r).not.toContain("expense:exp-1");
  });

  it("includes an education expense even when the flag is false", () => {
    const r = ids({
      ...base,
      expenses: [expense({ id: "exp-edu", type: "education", isGoal: false })],
    });
    expect(r).toContain("expense:exp-edu");
  });

  it("resolves a milestone-anchored start year rather than using the stored year", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ isGoal: true, startYear: 1999, startYearRef: "client_retirement" }),
      ],
    });
    expect(goals.find((g) => g.id === "expense:exp-1")?.year).toBe(2037);
  });

  it("sorts by resolved year ascending", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ id: "late", isGoal: true, startYear: 2050, endYear: 2050 }),
        expense({ id: "early", isGoal: true, startYear: 2029, endYear: 2032, type: "education" }),
      ],
    });
    expect(goals.map((g) => g.year)).toEqual([...goals.map((g) => g.year)].sort((a, b) => a - b));
  });

  it("labels the beneficiary on an education goal", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ id: "exp-edu", type: "education", forFamilyMemberId: "fm-kelly" }),
      ],
    });
    expect(goals.find((g) => g.id === "expense:exp-edu")?.forFamilyMemberName).toBe("Kelly");
  });

  // The bug this replaced: only ONE life-expectancy card was emitted, for the
  // LATER of the two deaths, so the first-to-die spouse never appeared on a
  // board whose entire point is a two-sided timeline.
  it("gives EACH spouse a life-expectancy card, on their own side of the spine", () => {
    const goals = buildMapGoals({
      ...base,
      // Dan dies 2064 (1972+92); Amy dies 2054 (1974+80) — she is first to die,
      // which is exactly the case the single-card version dropped.
      client: { ...base.client, spouseLifeExpectancy: 80 },
    });

    const client = goals.find((g) => g.id === "milestone:client_life_expectancy");
    expect(client).toMatchObject({ side: "client", year: 2064, title: "Dan's life expectancy" });

    const spouse = goals.find((g) => g.id === "milestone:spouse_life_expectancy");
    expect(spouse).toMatchObject({ side: "spouse", year: 2054, title: "Amy's life expectancy" });
  });

  // The second half of the same bug: the card's YEAR came from `milestones`
  // (both derived from the household-wide plan-end age) while its AGE came from
  // the person's real life expectancy, so the two disagreed. Nothing here may
  // read `milestones` — this asserts it by making those fields absurd.
  it("derives both years from birthYear + lifeExpectancy, never from milestones", () => {
    const goals = buildMapGoals({
      ...base,
      milestones: { ...milestones, clientEnd: 2099, spouseEnd: 2098, planEnd: 2097 },
    });

    expect(goals.find((g) => g.id === "milestone:client_life_expectancy")?.year).toBe(2064);
    expect(goals.find((g) => g.id === "milestone:spouse_life_expectancy")?.year).toBe(2064);
  });

  it("carries an editable payload whose age agrees with the card's year", () => {
    const goals = buildMapGoals(base);
    const card = goals.find((g) => g.id === "milestone:client_life_expectancy");

    expect(card?.lifeExpectancy).toEqual({ owner: "client", age: 92, assumed: false });
    // The year lives on the CARD, not on the payload — one derivation of
    // `birthYear + age`, so the spine and the editable age cannot disagree.
    expect(card?.year).toBe(2064);
    // Null everywhere else — its presence is what makes a card's age editable,
    // so a retirement milestone acquiring one would offer an editor that writes
    // the wrong column.
    expect(goals.find((g) => g.id === "milestone:client_retirement")?.lifeExpectancy).toBeNull();
  });

  it("drops a person's card when their birth year is unknown rather than inventing a year", () => {
    const goals = buildMapGoals({
      ...base,
      client: { ...base.client, spouseBirthYear: null },
    });
    expect(ids({ ...base, client: { ...base.client, spouseBirthYear: null } })).not.toContain(
      "milestone:spouse_life_expectancy",
    );
    expect(goals.find((g) => g.id === "milestone:client_life_expectancy")).toBeDefined();
  });

  it("classifies goal kinds from the expense type", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ id: "a", type: "education" }),
        expense({ id: "b", type: "other", isGoal: true }),
        expense({ id: "c", type: "living", isGoal: true }),
      ],
    });
    const byId = new Map(goals.map((g) => [g.id, g.kind]));
    expect(byId.get("expense:a")).toBe("education");
    expect(byId.get("expense:b")).toBe("purchase");
    expect(byId.get("expense:c")).toBe("household");
  });

  // A spouse with a DOB but no stored life expectancy is NOT hidden. The engine
  // is already projecting them to 95 (`spouseLifeExpectancy ?? 95` in
  // `computeFinalDeathYear`); showing that year flagged `assumed` is how an
  // advisor finds out. The old behaviour — dropping the age from the label —
  // hid the assumption instead.
  it("falls back to the engine's assumed 95 for a spouse with no stored life expectancy, and says so", () => {
    const goals = buildMapGoals({
      ...base,
      client: { ...base.client, spouseLifeExpectancy: null },
    });

    const spouse = goals.find((g) => g.id === "milestone:spouse_life_expectancy");
    expect(spouse?.year).toBe(1974 + ASSUMED_LIFE_EXPECTANCY);
    expect(spouse?.lifeExpectancy).toEqual({
      owner: "spouse",
      age: ASSUMED_LIFE_EXPECTANCY,
      assumed: true,
    });
    expect(spouse?.detail).toBe(`age ${ASSUMED_LIFE_EXPECTANCY} · assumed`);
  });

  // `buildClientMilestones` only populates the spouse milestones when a spouse
  // RETIREMENT AGE is set too. Keying the life-expectancy card off those hid it
  // for a spouse who has a DOB but has not retired on paper — two unrelated
  // facts.
  // ── Social Security milestones ──────────────────────────────────────────
  //
  // A card per principal, placed at the first year the projection PAYS the
  // benefit — not at the row's `startYear`, which is inert on an SS row.

  const withSs = (incomes: Income[]): BuildMapGoalsInput => ({
    ...base,
    socialSecurity: { incomes, clientInfo: CLIENT_INFO },
  });

  it("places the card at the first PAYING year, not the row's inert startYear", () => {
    // Dan born 1972, claims at 67 → 2039. `startYear` is 2026 and must not show.
    const goals = buildMapGoals(withSs([ssIncome()]));
    const card = goals.find((g) => g.id === "milestone:client_social_security");
    expect(card).toMatchObject({
      year: 2039,
      side: "client",
      kind: "social_security",
      title: "Dan claims Social Security",
    });
  });

  it("rounds a part-year claim age UP, matching the engine's whole-year comparison", () => {
    // 67y 6mo first pays at 68 → 1972 + 68 = 2040. A card at 2039 would name a
    // year the projection pays nothing in.
    const goals = buildMapGoals(withSs([ssIncome({ claimingAge: 67, claimingAgeMonths: 6 })]));
    expect(goals.find((g) => g.id === "milestone:client_social_security")?.year).toBe(2040);
  });

  it("reads the SPOUSE's dob and row for the spouse card", () => {
    // Amy born 1974, claims at 70 → 2044. Reading Dan's 1972 would give 2042.
    const goals = buildMapGoals(
      withSs([ssIncome(), ssIncome({ id: "ss-spouse", owner: "spouse", claimingAge: 70 })]),
    );
    const card = goals.find((g) => g.id === "milestone:spouse_social_security");
    expect(card).toMatchObject({ year: 2044, side: "spouse", title: "Amy claims Social Security" });
    expect(card?.socialSecurity?.incomeId).toBe("ss-spouse");
  });

  it("carries the row's annual amount as the editable figure in manual mode", () => {
    const goals = buildMapGoals(withSs([ssIncome({ annualAmount: 48000 })]));
    expect(goals.find((g) => g.id === "milestone:client_social_security")?.socialSecurity).toEqual({
      incomeId: "ss-client",
      owner: "client",
      mode: "manual_amount",
      amount: 48000,
      claimAgeLabel: "67",
      claimAgeYears: 67,
      claimAgeMode: "years",
      // Null in manual mode — `amount` IS the annual figure, and a second copy
      // of it is only somewhere for the two to drift.
      estimatedAnnual: null,
    });
  });

  // ── the claim-age editor's payload ──────────────────────────────────────
  //
  // `claimAgeYears` is what the inline age field HOLDS, and it must be the
  // RESOLVED age rather than the `claimingAge` column: in `fra` and
  // `at_retirement` modes that column is dead data the SS dialog carries forward
  // (production holds an `fra` row with `claimingAge: 53`), so seeding the editor
  // from it would open the field on a number the projection has never used.

  it("holds the FRA-DERIVED age for an fra row, NOT its stale claimingAge column", () => {
    // Dan born 1972 → FRA 67. The row's own `claimingAge: 53` is exactly the
    // dead-data shape production carries, and 53 ≠ 67 so this discriminates.
    const goals = buildMapGoals(
      withSs([ssIncome({ claimingAgeMode: "fra", claimingAge: 53 })]),
    );
    const card = goals.find((g) => g.id === "milestone:client_social_security");
    expect(card?.socialSecurity).toMatchObject({
      claimAgeYears: 67,
      claimAgeLabel: "67",
      claimAgeMode: "fra",
    });
    // And the card sits at the resolved year, not 1972 + 53 = 2025.
    expect(card?.year).toBe(2039);
  });

  it("holds the RETIREMENT age for an at_retirement row", () => {
    // `CLIENT_INFO.retirementAge` is 65, and the row's own column says 67 — so a
    // payload reading `claimingAge` would pass with 67 and be wrong.
    const goals = buildMapGoals(
      withSs([ssIncome({ claimingAgeMode: "at_retirement", claimingAge: 67 })]),
    );
    const card = goals.find((g) => g.id === "milestone:client_social_security");
    expect(card?.socialSecurity).toMatchObject({
      claimAgeYears: 65,
      claimAgeLabel: "65",
      claimAgeMode: "at_retirement",
    });
    expect(card?.year).toBe(2037);
  });

  // A stored NULL mode is "years" to `resolveClaimAgeMonths`, and the payload has
  // to agree with it or the card would label a legacy row as derived.
  it("reports an absent claim-age mode as years", () => {
    const goals = buildMapGoals(withSs([ssIncome({ claimingAgeMode: undefined })]));
    expect(
      goals.find((g) => g.id === "milestone:client_social_security")?.socialSecurity,
    ).toMatchObject({ claimAgeMode: "years", claimAgeYears: 67 });
  });

  // The one field carries the WHOLE age so the editor can round-trip a stored
  // months value instead of zeroing it. 67y 6mo is 67.5 years; a payload of 67
  // would make typing "67" a no-op that leaves the 6mo in place.
  it("carries a part-year age as a FRACTION, so the editor cannot silently zero it", () => {
    const goals = buildMapGoals(withSs([ssIncome({ claimingAge: 67, claimingAgeMonths: 6 })]));
    expect(
      goals.find((g) => g.id === "milestone:client_social_security")?.socialSecurity,
    ).toMatchObject({ claimAgeYears: 67.5, claimAgeLabel: "67y 6mo" });
  });

  it("carries the MONTHLY pia as the editable figure in pia mode, with the annual it implies", () => {
    const goals = buildMapGoals(
      withSs([ssIncome({ ssBenefitMode: "pia_at_fra", piaMonthly: 2800, claimingAge: 70 })]),
    );
    const ss = goals.find((g) => g.id === "milestone:client_social_security")?.socialSecurity;
    // The editable figure is the PIA, not the derived benefit — editing the
    // derived number would silently rewrite the SSA-statement figure.
    expect(ss).toMatchObject({ mode: "pia_at_fra", amount: 2800 });
    // Claiming at 70 against a 67 FRA is a delayed-credit bump, so the annual
    // must EXCEED a flat 12 × PIA. An `estimatedAnnual` equal to 33_600 would
    // mean the claim age never reached `computeOwnMonthlyBenefit`.
    expect(ss?.estimatedAnnual).toBeGreaterThan(2800 * 12);
  });

  // The engine loader writes `?? undefined` for every absent optional column, so
  // ABSENT is what a row predating the mode column looks like here.
  it("treats an absent benefit mode as manual, as the SS card and dialog do", () => {
    const goals = buildMapGoals(
      withSs([ssIncome({ ssBenefitMode: undefined, annualAmount: 30000 })]),
    );
    expect(
      goals.find((g) => g.id === "milestone:client_social_security")?.socialSecurity,
    ).toMatchObject({ mode: "manual_amount", amount: 30000 });
  });

  it("omits the card for a no_benefit row — the engine pays it nothing", () => {
    const goals = buildMapGoals(withSs([ssIncome({ ssBenefitMode: "no_benefit" })]));
    expect(goals.map((g) => g.id)).not.toContain("milestone:client_social_security");
  });

  // `engine/income.ts` only enters its claim-age branch when `claimingAge` is
  // set; without one the row is paid from `startYear` like ordinary income, so a
  // "starts at 67" card would name a year the projection never uses.
  it("omits the card when claimingAge is absent, however resolvable the mode is", () => {
    const goals = buildMapGoals(
      withSs([ssIncome({ claimingAge: undefined, claimingAgeMode: "fra" })]),
    );
    expect(goals.map((g) => g.id)).not.toContain("milestone:client_social_security");
  });

  it("omits the card when the claim age cannot be resolved", () => {
    const noSpouseRetirement = { ...CLIENT_INFO, spouseRetirementAge: undefined };
    const goals = buildMapGoals({
      ...base,
      socialSecurity: {
        incomes: [ssIncome({ id: "ss-spouse", owner: "spouse", claimingAgeMode: "at_retirement" })],
        clientInfo: noSpouseRetirement,
      },
    });
    expect(goals.map((g) => g.id)).not.toContain("milestone:spouse_social_security");
  });

  it("omits a person's card when they have no SS row at all", () => {
    const goals = buildMapGoals(withSs([ssIncome()]));
    const ids = goals.map((g) => g.id);
    expect(ids).toContain("milestone:client_social_security");
    expect(ids).not.toContain("milestone:spouse_social_security");
  });

  it("ignores non-social-security incomes", () => {
    const goals = buildMapGoals(withSs([ssIncome({ id: "salary", type: "salary" } as Partial<Income>)]));
    expect(goals.map((g) => g.id)).not.toContain("milestone:client_social_security");
  });

  it("sorts the SS card into the spine by its paying year like any other", () => {
    const goals = buildMapGoals(withSs([ssIncome()]));
    expect(goals.map((g) => g.year)).toEqual([...goals.map((g) => g.year)].sort((a, b) => a - b));
  });

  // The read-only fallback the client portal renders. It must carry the same
  // three facts the editable slot does, or a viewer loses the number the card
  // exists for.
  it("writes a detail line carrying the claim age and the benefit", () => {
    const manual = buildMapGoals(withSs([ssIncome({ annualAmount: 48000 })]));
    expect(manual.find((g) => g.id === "milestone:client_social_security")?.detail).toBe(
      "age 67 · $48,000/yr",
    );

    const pia = buildMapGoals(
      withSs([ssIncome({ ssBenefitMode: "pia_at_fra", piaMonthly: 2800, claimingAge: 67 })]),
    );
    expect(pia.find((g) => g.id === "milestone:client_social_security")?.detail).toMatch(
      /^age 67 · \$2,800\/mo · est\. \$\d[\d,]*\/yr$/,
    );
  });

  // An inline age edit CONVERTS a derived row to an explicit age, which stops it
  // tracking future DOB / retirement-age changes. Naming the mode is what keeps
  // that from being a blind choice — and the read-only Organizer, which renders
  // this string instead of the editors, gains the same fact.
  it("names a DERIVED claim-age mode in the detail line, and stays quiet for years", () => {
    const fra = buildMapGoals(withSs([ssIncome({ claimingAgeMode: "fra" })]));
    expect(fra.find((g) => g.id === "milestone:client_social_security")?.detail).toBe(
      "age 67 (FRA) · $48,000/yr",
    );

    const atRetirement = buildMapGoals(
      withSs([ssIncome({ claimingAgeMode: "at_retirement" })]),
    );
    expect(
      atRetirement.find((g) => g.id === "milestone:client_social_security")?.detail,
    ).toBe("age 65 (at retirement) · $48,000/yr");

    // No hint in `years` mode — the age IS the stored choice, so a parenthetical
    // would be noise on every card that has one.
    const years = buildMapGoals(withSs([ssIncome({ claimingAgeMode: "years" })]));
    expect(years.find((g) => g.id === "milestone:client_social_security")?.detail).toBe(
      "age 67 · $48,000/yr",
    );
  });

  it("says the PIA is unset rather than showing $0 as a benefit", () => {
    const goals = buildMapGoals(
      withSs([ssIncome({ ssBenefitMode: "pia_at_fra", piaMonthly: undefined })]),
    );
    const card = goals.find((g) => g.id === "milestone:client_social_security");
    expect(card?.detail).toBe("age 67 · PIA not set");
    expect(card?.socialSecurity?.estimatedAnnual).toBeNull();
  });

  it("shows the spouse's life expectancy even with no spouse retirement age", () => {
    const goals = buildMapGoals({
      ...base,
      milestones: { ...milestones, spouseRetirement: undefined, spouseEnd: undefined },
      client: { ...base.client, spouseRetirementAge: null },
    });

    expect(goals.map((g) => g.id)).toContain("milestone:spouse_life_expectancy");
    expect(goals.find((g) => g.id === "milestone:spouse_life_expectancy")?.year).toBe(2064);
  });
});
