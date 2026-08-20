/**
 * What the savings goal calculator remembers between visits, and the one
 * function allowed to turn a request body into it.
 *
 * The payload lands in a jsonb column, which is the easiest place in this
 * codebase to reintroduce mass assignment: `.set({ state: body.state })`
 * would happily store whatever the caller sent. So `validateSavingsGoalState`
 * REBUILDS the object field by field and returns only what it constructed —
 * an unrecognised key is dropped rather than persisted. Same shape as
 * `validateDebtPaydownState` beside it.
 *
 * Unlike that sibling there is no deep-frozen module-level default here:
 * every field below is a primitive, so there are no nested arrays or objects
 * for one client's mutation to leak into the next client's starting point.
 * The factory alone is enough.
 *
 * Shared by the route handler and the client workspace so the browser
 * enforces the same limits it will be judged by.
 */

export interface SavingsGoalState {
  v: 1;
  /** The client's label for the goal. Never empty. */
  name: string;
  /** What it costs in TODAY's dollars. */
  targetToday: number;
  /** The calendar year they want it. The goal month is January of it. */
  targetYear: number;
  currentSavings: number;
  /** Annual FRACTION — 0.06 is 6%. */
  annualReturn: number;
  /** `solve` asks for the required contribution; `contribute` states one. */
  mode: "solve" | "contribute";
  monthlyContribution: number;
}

export const MAX_NAME_LENGTH = 60;
export const MAX_AMOUNT = 1e9;
/** Annual fraction. 50% is far past any defensible expected return. */
export const MAX_RETURN = 0.5;
export const MIN_TARGET_YEAR = 2000;
export const MAX_TARGET_YEAR = 2200;
export const MAX_STATE_BYTES = 4 * 1024;

/** How far out a fresh goal is pencilled in. */
export const DEFAULT_YEARS_OUT = 5;
/** Middle chip of the three on the screen — `RETURNS` imports it, so they cannot drift. */
export const DEFAULT_ANNUAL_RETURN = 0.06;

/**
 * Always returns a FRESH object.
 *
 * The name is deliberately non-empty: the validator rejects a blank one, and
 * a default of "" would leave a client who typed a cost but no name unable to
 * autosave at all.
 */
export function createDefaultSavingsGoalState(): SavingsGoalState {
  return {
    v: 1,
    name: "My goal",
    targetToday: 0,
    targetYear: new Date().getFullYear() + DEFAULT_YEARS_OUT,
    currentSavings: 0,
    annualReturn: DEFAULT_ANNUAL_RETURN,
    mode: "solve",
    monthlyContribution: 0,
  };
}

export type SavingsGoalStateResult =
  | { ok: true; state: SavingsGoalState }
  | { ok: false; error: string };

/** A finite number in [0, max]. Anything else — null, an object, "" — is null. */
function num(raw: unknown, max: number): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

export function validateSavingsGoalState(raw: unknown): SavingsGoalStateResult {
  if (!isPlainObject(raw)) return { ok: false, error: "state must be an object" };

  const name =
    typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : "";
  if (name === "") return { ok: false, error: "Give your goal a name." };

  const targetToday = raw.targetToday == null || raw.targetToday === "" ? 0 : num(raw.targetToday, MAX_AMOUNT);
  if (targetToday === null) {
    return { ok: false, error: "Enter what the goal costs as a number." };
  }

  if (
    typeof raw.targetYear !== "number" ||
    !Number.isInteger(raw.targetYear) ||
    raw.targetYear < MIN_TARGET_YEAR ||
    raw.targetYear > MAX_TARGET_YEAR
  ) {
    return { ok: false, error: "Pick a year for this goal." };
  }
  const targetYear = raw.targetYear;

  const currentSavings = raw.currentSavings == null || raw.currentSavings === "" ? 0 : num(raw.currentSavings, MAX_AMOUNT);
  if (currentSavings === null) {
    return { ok: false, error: "Enter what you have saved as a number." };
  }

  const annualReturn =
    raw.annualReturn == null || raw.annualReturn === ""
      ? 0
      : num(raw.annualReturn, MAX_RETURN);
  if (annualReturn === null) {
    return { ok: false, error: "Pick an expected return between 0% and 50%." };
  }

  const mode = raw.mode === "contribute" ? "contribute" : "solve";

  const monthlyContribution =
    raw.monthlyContribution == null || raw.monthlyContribution === "" ? 0 : num(raw.monthlyContribution, MAX_AMOUNT);
  if (monthlyContribution === null) {
    return { ok: false, error: "Enter your monthly saving as a number." };
  }

  const state: SavingsGoalState = {
    v: 1,
    name,
    targetToday,
    targetYear,
    currentSavings,
    annualReturn,
    mode,
    monthlyContribution,
  };
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    return { ok: false, error: "That is more than this calculator can save." };
  }
  return { ok: true, state };
}
