import { describe, it, expect } from "vitest";
import { STEPS, nextStep, prevStep, stepIndex } from "../steps";
import { STEP_SLUGS, isStepSlug } from "../types";

describe("onboarding step manifest", () => {
  it("runs the eight guided-setup steps in order", () => {
    expect(STEPS.map((s) => s.slug)).toEqual([
      "household",
      "family",
      "accounts",
      "liabilities",
      "cash-flow",
      "insurance",
      "assumptions",
      "review",
    ]);
    expect([...STEP_SLUGS]).toEqual(STEPS.map((s) => s.slug));
  });

  it("labels the accounts step 'Assets'", () => {
    expect(STEPS.find((s) => s.slug === "accounts")!.label).toBe("Assets");
  });

  it("no longer offers Trusts or Estate steps", () => {
    const labels = STEPS.map((s) => s.label);
    expect(labels).not.toContain("Trusts");
    expect(labels).not.toContain("Estate");
    // Persisted `lastStepVisited` / `skippedSteps` may still carry the retired
    // slugs — they have to read as unknown so callers route around them.
    expect(isStepSlug("entities")).toBe(false);
    expect(isStepSlug("estate")).toBe(false);
  });

  it("walks neighbours across the retired slots without a gap", () => {
    expect(nextStep("family")).toBe("accounts");
    expect(prevStep("accounts")).toBe("family");
    expect(nextStep("insurance")).toBe("assumptions");
    expect(prevStep("assumptions")).toBe("insurance");
    expect(prevStep("household")).toBeNull();
    expect(nextStep("review")).toBeNull();
    expect(stepIndex("accounts")).toBe(2);
  });
});
