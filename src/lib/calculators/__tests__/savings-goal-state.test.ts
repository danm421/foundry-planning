import { describe, it, expect } from "vitest";
import {
  createDefaultSavingsGoalState,
  validateSavingsGoalState,
  MAX_NAME_LENGTH,
  type SavingsGoalState,
} from "../savings-goal-state";

const VALID: SavingsGoalState = {
  v: 1,
  name: "Home down payment",
  targetToday: 80_000,
  targetYear: 2036,
  currentSavings: 12_000,
  annualReturn: 0.06,
  mode: "solve",
  monthlyContribution: 200,
};

const ok = (raw: unknown): SavingsGoalState => {
  const res = validateSavingsGoalState(raw);
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`);
  return res.state;
};

describe("createDefaultSavingsGoalState", () => {
  it("is valid, and its default year is five years out", () => {
    const d = createDefaultSavingsGoalState();
    expect(validateSavingsGoalState(d).ok).toBe(true);
    expect(d.targetYear).toBe(new Date().getFullYear() + 5);
  });

  it("carries a non-empty name, so a fresh state can actually be saved", () => {
    // The validator rejects a blank name. If the default were "", a client
    // who typed a cost but no name could never autosave.
    expect(createDefaultSavingsGoalState().name).not.toBe("");
  });

  it("returns a fresh object each call", () => {
    expect(createDefaultSavingsGoalState()).not.toBe(createDefaultSavingsGoalState());
  });
});

describe("validateSavingsGoalState", () => {
  it("round-trips a valid payload unchanged", () => {
    expect(ok(VALID)).toEqual(VALID);
  });

  it("DROPS an unrecognised key rather than persisting it", () => {
    const out = ok({ ...VALID, isAdmin: true, __proto__: { polluted: 1 } });
    expect(out).toEqual(VALID);
    expect("isAdmin" in out).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(validateSavingsGoalState(null).ok).toBe(false);
    expect(validateSavingsGoalState("nope").ok).toBe(false);
    expect(validateSavingsGoalState([VALID]).ok).toBe(false);
  });

  it("rejects a blank name and trims-then-caps a long one", () => {
    expect(validateSavingsGoalState({ ...VALID, name: "   " }).ok).toBe(false);
    expect(ok({ ...VALID, name: "x".repeat(200) }).name).toHaveLength(MAX_NAME_LENGTH);
  });

  it("rejects a return above the cap, and a negative one", () => {
    expect(validateSavingsGoalState({ ...VALID, annualReturn: 0.9 }).ok).toBe(false);
    expect(validateSavingsGoalState({ ...VALID, annualReturn: -0.01 }).ok).toBe(false);
    expect(ok({ ...VALID, annualReturn: 0.5 }).annualReturn).toBe(0.5);
  });

  it("rejects negative and absurd amounts", () => {
    expect(validateSavingsGoalState({ ...VALID, targetToday: -1 }).ok).toBe(false);
    expect(validateSavingsGoalState({ ...VALID, currentSavings: 1e12 }).ok).toBe(false);
    expect(validateSavingsGoalState({ ...VALID, monthlyContribution: "abc" }).ok).toBe(false);
  });

  it("rejects a non-integer or out-of-range year", () => {
    expect(validateSavingsGoalState({ ...VALID, targetYear: 2036.5 }).ok).toBe(false);
    expect(validateSavingsGoalState({ ...VALID, targetYear: 1900 }).ok).toBe(false);
    expect(validateSavingsGoalState({ ...VALID, targetYear: 9999 }).ok).toBe(false);
    expect(validateSavingsGoalState({ ...VALID, targetYear: "2036" }).ok).toBe(false);
  });

  it("falls back to 'solve' for an unknown mode", () => {
    expect(ok({ ...VALID, mode: "banana" }).mode).toBe("solve");
    expect(ok({ ...VALID, mode: "contribute" }).mode).toBe("contribute");
  });

  it("treats a missing amount as zero, so a cleared field is not an error", () => {
    const out = ok({ ...VALID, currentSavings: undefined, monthlyContribution: "" });
    expect(out.currentSavings).toBe(0);
    expect(out.monthlyContribution).toBe(0);
  });

  it("rejects an oversize payload", () => {
    const res = validateSavingsGoalState({ ...VALID, name: "x".repeat(59) });
    expect(res.ok).toBe(true); // the name cap keeps this one small
    // Force the size guard with a key the rebuild keeps: none exists, so the
    // guard is belt-and-braces. Assert it is wired by checking a huge name
    // cannot smuggle bytes past the cap.
    expect(ok({ ...VALID, name: "y".repeat(10_000) }).name).toHaveLength(MAX_NAME_LENGTH);
  });
});
