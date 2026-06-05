import { describe, it, expect } from "vitest";
import {
  isQsWizardStep,
  quickStartResumeStep,
  mergeQuickStartState,
} from "@/lib/quick-start/state";

describe("isQsWizardStep", () => {
  it("accepts wizard steps", () => {
    expect(isQsWizardStep("income")).toBe(true);
    expect(isQsWizardStep("assumptions")).toBe(true);
  });
  it("rejects basics, junk, and non-strings", () => {
    expect(isQsWizardStep("basics")).toBe(false);
    expect(isQsWizardStep("nope")).toBe(false);
    expect(isQsWizardStep(undefined)).toBe(false);
  });
});

describe("quickStartResumeStep", () => {
  it("returns the step when in progress", () => {
    expect(quickStartResumeStep({ lastStepVisited: "accounts" })).toBe("accounts");
  });
  it("is null when not started", () => {
    expect(quickStartResumeStep({})).toBeNull();
    expect(quickStartResumeStep(null)).toBeNull();
  });
  it("is null when completed or dismissed", () => {
    expect(
      quickStartResumeStep({ lastStepVisited: "income", completedAt: "2026-06-05T00:00:00Z" }),
    ).toBeNull();
    expect(
      quickStartResumeStep({ lastStepVisited: "income", dismissedAt: "2026-06-05T00:00:00Z" }),
    ).toBeNull();
  });
});

describe("mergeQuickStartState", () => {
  const NOW = "2026-06-05T12:00:00.000Z";
  it("records lastStepVisited and clears a prior dismissal", () => {
    const next = mergeQuickStartState(
      { dismissedAt: "2026-01-01T00:00:00Z" },
      { lastStepVisited: "expenses" },
      NOW,
    );
    expect(next.lastStepVisited).toBe("expenses");
    expect(next.dismissedAt).toBeUndefined();
  });
  it("ignores an invalid step", () => {
    const next = mergeQuickStartState({}, { lastStepVisited: "basics" }, NOW);
    expect(next.lastStepVisited).toBeUndefined();
  });
  it("stamps completedAt", () => {
    const next = mergeQuickStartState({ lastStepVisited: "assumptions" }, { completed: true }, NOW);
    expect(next.completedAt).toBe(NOW);
  });
  it("stamps dismissedAt", () => {
    const next = mergeQuickStartState({ lastStepVisited: "income" }, { dismissed: true }, NOW);
    expect(next.dismissedAt).toBe(NOW);
  });
});
