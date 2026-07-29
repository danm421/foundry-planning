// src/lib/household-map/__tests__/life-expectancy-write.test.ts
//
// Shape tests for the Goals board's life-expectancy write payloads.
// `life-expectancy-write-contract.test.ts` next door drives the same payloads
// through the REAL validators and lookup maps they are sent to; this file pins
// what the builders produce.
//
// The horizon is the whole reason this module exists. Life expectancy is the
// only field on the Household Map that moves `planSettings.planEndYear`, which
// bounds the engine's year loop — so every assertion below that looks like
// arithmetic is really "does the projection stop in the year the card says it
// does".

import { describe, it, expect } from "vitest";
import {
  MAX_LIFE_EXPECTANCY,
  buildLifeExpectancyClientFields,
  buildLifeExpectancyPlanSettingsFields,
  buildSingletonScenarioFields,
  isValidLifeExpectancy,
  lifeExpectancyBasePayload,
} from "../life-expectancy-write";

// Dan 1972 + 92 -> dies 2064. Amy 1974 + 90 -> dies 2064 too. Deliberately a
// TIE at base: every case below moves exactly one of them, so a builder that
// read the wrong person's death year would still agree with the fixture at rest
// and disagree the moment a test perturbs it.
const CLIENT_FIELDS = {
  firstName: "Dan",
  lastName: "Cooper",
  dateOfBirth: "1972-03-04",
  lifeExpectancy: 92,
  spouseName: "Amy",
  spouseDob: "1974-06-01",
  spouseLifeExpectancy: 90,
  planEndAge: 92,
  filingStatus: "married_joint",
  // The Solver's signature override. Present in every fixture because the
  // whole-singleton payload exists to stop a life-expectancy edit deleting it.
  retirementAge: 62,
} as const;

const PLAN_SETTINGS_FIELDS = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.028,
  planStartYear: 2026,
  planEndYear: 2064,
} as const;

const fields = () => ({ ...CLIENT_FIELDS }) as Record<string, unknown>;
const planSettings = () => ({ ...PLAN_SETTINGS_FIELDS }) as Record<string, unknown>;

// ── Validation ──────────────────────────────────────────────────────────────

describe("isValidLifeExpectancy", () => {
  // Dan is 54 in 2026.
  const BIRTH_YEAR = 1972;
  const CURRENT_YEAR = 2026;
  const valid = (age: number, birthYear: number | null = BIRTH_YEAR) =>
    isValidLifeExpectancy(age, birthYear, CURRENT_YEAR);

  it("accepts an ordinary age", () => {
    expect(valid(92)).toBe(true);
  });

  // Below the person's CURRENT age the derived death year lands before the plan
  // starts, and `computeFinalDeathYear` returns null for that — so the
  // projection runs with NO death event rather than an early one. Accepting 53
  // here means typing a low number silently removes the death from the plan.
  it("rejects an age below the person's current age", () => {
    expect(valid(53)).toBe(false);
  });

  // The boundary is inclusive on purpose: dying in the plan's first year is
  // something the engine does model.
  it("accepts an age EQUAL to the current age (death in the plan's first year)", () => {
    expect(valid(54)).toBe(true);
  });

  it(`accepts exactly ${MAX_LIFE_EXPECTANCY} and rejects one past it`, () => {
    expect(valid(MAX_LIFE_EXPECTANCY)).toBe(true);
    expect(valid(MAX_LIFE_EXPECTANCY + 1)).toBe(false);
  });

  // The ceiling mirrors the Solver's sliders (`max={110}`). Two editors of the
  // same field disagreeing about what is plausible is its own bug.
  it("pins the ceiling at the Solver's slider max", () => {
    expect(MAX_LIFE_EXPECTANCY).toBe(110);
  });

  it("rejects a non-integer age", () => {
    expect(valid(92.5)).toBe(false);
  });

  // `InlineAmount.commit` sends `Number(cleanInput(draft) || "0")`, so an
  // emptied field arrives here as 0 rather than as NaN or "". It must be
  // rejected by the current-age floor, not written as a death in 1972.
  it("rejects 0 — the value an emptied field commits", () => {
    expect(valid(0)).toBe(false);
  });

  it("rejects NaN", () => {
    expect(valid(Number.NaN)).toBe(false);
  });

  // No birth year, no derivable death year. The card is not even rendered in
  // that case, but the writer must not depend on the board's gating.
  it("rejects any age when the birth year is unknown", () => {
    expect(valid(92, null)).toBe(false);
    expect(valid(MAX_LIFE_EXPECTANCY, null)).toBe(false);
  });

  // `currentYear` is a parameter rather than a `new Date()` call inside the
  // function; the same age is valid or not depending on the year passed.
  it("takes the current year from its argument, not the clock", () => {
    expect(isValidLifeExpectancy(60, BIRTH_YEAR, 2026)).toBe(true);
    expect(isValidLifeExpectancy(60, BIRTH_YEAR, 2040)).toBe(false);
  });
});

// ── Base mode ───────────────────────────────────────────────────────────────

describe("lifeExpectancyBasePayload", () => {
  it("writes the client's column", () => {
    expect(lifeExpectancyBasePayload("client", 96)).toEqual({ lifeExpectancy: 96 });
  });

  it("writes the spouse's column — a different column, not a flag on the same one", () => {
    expect(lifeExpectancyBasePayload("spouse", 88)).toEqual({ spouseLifeExpectancy: 88 });
  });

  // `toEqual` above already pins this, but it is the point of the payload and
  // worth failing loudly: the PUT route re-derives `planEndAge` itself and
  // pushes the new `planEndYear` to every plan_settings row. Sending our own
  // `planEndAge` would land in `MUTABLE_CLIENT_FIELDS`, then be overwritten by
  // the route's — two derivations of one number, free to drift.
  it("sends ONLY the changed column — never a planEndAge the route re-derives", () => {
    for (const owner of ["client", "spouse"] as const) {
      const payload = lifeExpectancyBasePayload(owner, 96);
      expect(Object.keys(payload)).toHaveLength(1);
      expect(payload).not.toHaveProperty("planEndAge");
      expect(payload).not.toHaveProperty("planEndYear");
    }
  });
});

// ── Singleton pruning ───────────────────────────────────────────────────────

describe("buildSingletonScenarioFields", () => {
  // The engine's loaders emit `x ?? undefined` for every absent optional
  // column, while the base tree those get diffed against carries `null`.
  // `valuesEqual(null, undefined)` is false, so an explicit `undefined` diffs as
  // a change and then vanishes in `JSON.stringify` — writing "no value" over a
  // real base value.
  it("drops undefined keys", () => {
    const out = buildSingletonScenarioFields({
      lifeExpectancy: 92,
      spouseLifeExpectancy: undefined,
    });
    expect(out).not.toHaveProperty("spouseLifeExpectancy");
    expect(out).toEqual({ lifeExpectancy: 92 });
  });

  // null is a REAL stored value ("this person has no spouse LE on record"), not
  // an absent one — pruning it would silently stop the scenario overriding it.
  it("keeps null, and keeps falsy values that are not undefined", () => {
    const out = buildSingletonScenarioFields({
      spouseLifeExpectancy: null,
      retirementMonth: 0,
      isSelfEmployment: false,
      spouseName: "",
    });
    expect(out).toEqual({
      spouseLifeExpectancy: null,
      retirementMonth: 0,
      isSelfEmployment: false,
      spouseName: "",
    });
  });

  it("survives the JSON round-trip the fetch performs, losing no key", () => {
    const out = buildSingletonScenarioFields({ ...CLIENT_FIELDS, spouseRetirementAge: undefined });
    const overTheWire = JSON.parse(JSON.stringify(out));
    expect(Object.keys(overTheWire).sort()).toEqual(Object.keys(out).sort());
  });
});

// ── Scenario mode: the client singleton ─────────────────────────────────────

describe("buildLifeExpectancyClientFields", () => {
  // THE clobber guard. `applyEntityEdit` upserts with `set: { payload: diff }` —
  // a wholesale replace — and `buildFieldDiff` only emits keys the caller sent.
  // A narrow `{ lifeExpectancy }` write against a Solver-built scenario would
  // delete its `retirementAge: 62` override, silently, and the plan would
  // quietly go back to retiring at 65.
  it("carries every field the scenario already overrode, not just the changed one", () => {
    const out = buildLifeExpectancyClientFields(fields(), "client", 96);

    expect(out.retirementAge).toBe(62);
    expect(out.filingStatus).toBe("married_joint");
    expect(out.spouseDob).toBe("1974-06-01");
    expect(out.spouseLifeExpectancy).toBe(90);
  });

  it("sets the client's column and re-derives the horizon it moves", () => {
    // Dan 1972 + 96 -> 2068, past Amy's 2064, so he is now last to die.
    const out = buildLifeExpectancyClientFields(fields(), "client", 96);
    expect(out.lifeExpectancy).toBe(96);
    expect(out.planEndAge).toBe(96);
  });

  // DISCRIMINATING. `planEndAge` is the PRIMARY client's age in the year the
  // LAST spouse dies, so a spouse-side edit moves it — and moves it to a number
  // that is neither the age just typed (100) nor the age it replaced (90).
  // A builder that assigned the edited age, or that only recomputed on
  // client-side edits, passes every other case in this file and fails here.
  it("recomputes planEndAge from BOTH spouses — a spouse edit moves the client's plan-end age", () => {
    // Amy 1974 + 100 -> 2074. Dan is born 1972, so 2074 is his age 102.
    const out = buildLifeExpectancyClientFields(fields(), "spouse", 100);

    expect(out.spouseLifeExpectancy).toBe(100);
    expect(out.planEndAge).toBe(102);
    // Dan's own life expectancy is untouched — only the horizon moved.
    expect(out.lifeExpectancy).toBe(92);
  });

  // The mirror image, and the second half of "from BOTH spouses": shortening
  // the client's life does NOT shorten the plan while the spouse still outlives
  // him. `planEndAge` (92) and the edited `lifeExpectancy` (80) must disagree.
  it("leaves planEndAge alone when the edited person is no longer the last to die", () => {
    // Dan 1972 + 80 -> 2052; Amy still dies 2064, which is Dan's age 92.
    const out = buildLifeExpectancyClientFields(fields(), "client", 80);

    expect(out.lifeExpectancy).toBe(80);
    expect(out.planEndAge).toBe(92);
  });

  it("treats an unmarried household's client as the last to die", () => {
    const solo = { ...fields() };
    delete solo.spouseDob;
    delete solo.spouseLifeExpectancy;

    const out = buildLifeExpectancyClientFields(solo, "client", 88);
    expect(out.planEndAge).toBe(88);
  });

  // A spouse DOB with no stored LE: `planHorizonFromLifeExpectancy` applies the
  // engine's own `?? 95`, the same fallback the board's "assumed" card shows.
  // The card and the horizon have to be reading the same assumption.
  it("applies the engine's assumed 95 for a spouse with a DOB but no stored life expectancy", () => {
    const noSpouseLe = { ...fields(), spouseLifeExpectancy: null };
    // Amy 1974 + 95 -> 2069 = Dan's age 97.
    const out = buildLifeExpectancyClientFields(noSpouseLe, "client", 92);
    expect(out.planEndAge).toBe(97);
  });

  // `planEndAge` is NOT NULL on the base row, and a `{ from: 92, to: undefined }`
  // diff would blank the plan horizon for the entire scenario. Leaving the
  // scenario on its existing (stale but projectable) planEndAge is the lesser
  // evil — so the key must come through UNCHANGED, never nulled or dropped.
  it("leaves planEndAge exactly as it was when the DOB is unparseable", () => {
    const noDob = { ...fields(), dateOfBirth: null };
    const out = buildLifeExpectancyClientFields(noDob, "client", 96);

    expect(out.lifeExpectancy).toBe(96);
    expect(out.planEndAge).toBe(92);
    expect(out.planEndAge).not.toBeNull();
  });

  it("does not mutate the caller's field set", () => {
    const input = fields();
    buildLifeExpectancyClientFields(input, "client", 96);
    expect(input.lifeExpectancy).toBe(92);
    expect(input.planEndAge).toBe(92);
  });
});

// ── Scenario mode: the plan_settings singleton ──────────────────────────────

describe("buildLifeExpectancyPlanSettingsFields", () => {
  it("carries the scenario's other plan_settings overrides alongside the new horizon", () => {
    const out = buildLifeExpectancyPlanSettingsFields(planSettings(), fields(), "client", 96);

    expect(out?.inflationRate).toBe(0.028);
    expect(out?.flatFederalRate).toBe(0.22);
    expect(out?.planStartYear).toBe(2026);
  });

  it("writes a calendar YEAR, derived from the same last-death rule", () => {
    // Dan 1972 + 96 -> 2068.
    expect(buildLifeExpectancyPlanSettingsFields(planSettings(), fields(), "client", 96)?.planEndYear)
      .toBe(2068);
    // Amy 1974 + 100 -> 2074 — a spouse edit moves the horizon just as much.
    expect(
      buildLifeExpectancyPlanSettingsFields(planSettings(), fields(), "spouse", 100)?.planEndYear,
    ).toBe(2074);
  });

  it("leaves planEndYear at the surviving spouse's death year when the edited person dies first", () => {
    // Dan 1972 + 80 -> 2052, but Amy still dies 2064, so the plan still ends 2064.
    expect(
      buildLifeExpectancyPlanSettingsFields(planSettings(), fields(), "client", 80)?.planEndYear,
    ).toBe(2064);
  });

  // Null rather than a no-op payload: posting `{...planSettingsFields}` with no
  // horizon change would still REPLACE this scenario's plan_settings payload
  // wholesale, for nothing gained. The caller skips the second write instead.
  it("returns null — not a payload — when the horizon can't be derived", () => {
    const noDob = { ...fields(), dateOfBirth: null };
    expect(buildLifeExpectancyPlanSettingsFields(planSettings(), noDob, "client", 96)).toBeNull();
  });

  it("returns null when the DOB is present but unparseable", () => {
    const badDob = { ...fields(), dateOfBirth: "not-a-date" };
    expect(buildLifeExpectancyPlanSettingsFields(planSettings(), badDob, "client", 96)).toBeNull();
  });

  it("does not mutate the caller's field set", () => {
    const input = planSettings();
    buildLifeExpectancyPlanSettingsFields(input, fields(), "client", 96);
    expect(input.planEndYear).toBe(2064);
  });
});

// ── The two payloads together ───────────────────────────────────────────────

// They are written as two separate, NON-ATOMIC scenario_changes rows, so
// nothing at runtime forces them to agree. If they ever disagree the boards
// render one horizon while the engine projects to another — which is the exact
// class of bug this whole feature was fixing.
describe("the client and plan_settings payloads agree about the horizon", () => {
  it.each([
    ["client", 96],
    ["client", 80],
    ["spouse", 100],
    ["spouse", 84],
  ] as const)("clientBirthYear + planEndAge === planEndYear (%s -> %i)", (owner, age) => {
    const clientOut = buildLifeExpectancyClientFields(fields(), owner, age);
    const planOut = buildLifeExpectancyPlanSettingsFields(planSettings(), fields(), owner, age);

    expect(1972 + (clientOut.planEndAge as number)).toBe(planOut?.planEndYear);
  });
});
