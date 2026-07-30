import { describe, expect, it } from "vitest";
import { RISK_LEVELS } from "@/lib/risk-levels";
import { GOALS_PROMPT, GOALS_VERSION } from "../prompts/goals";
import { ASSUMPTIONS_PROMPT, ASSUMPTIONS_VERSION } from "../prompts/assumptions";

describe("goal + assumption prompts", () => {
  it("are versioned", () => {
    expect(GOALS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(ASSUMPTIONS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("goals prompt asks for the education cost breakdown", () => {
    for (const key of ["tuition", "roomAndBoard", "booksAndSupplies", "institutionName"]) {
      expect(GOALS_PROMPT).toContain(key);
    }
  });

  it("goals prompt enumerates the four kinds", () => {
    expect(GOALS_PROMPT).toContain("retirement");
    expect(GOALS_PROMPT).toContain("education");
    expect(GOALS_PROMPT).toContain("one_time");
    expect(GOALS_PROMPT).toContain("recurring");
  });

  it("assumptions prompt does not ask the model to invent figures", () => {
    expect(ASSUMPTIONS_PROMPT).toContain("do not guess");
    expect(ASSUMPTIONS_PROMPT).toContain("inflationRate");
  });

  // Regression: goals prompt must encode the endYear-equals-startYear rule for "Ends: After 1 Years"
  it("goals prompt encodes endYear equals startYear for one-year goals", () => {
    expect(GOALS_PROMPT).toMatch(/Ends:.*After 1 Years.*equals.*startYear|endYear.*equals.*startYear/i);
  });

  // Regression: assumptions prompt must distinguish TARGET probability from achieved/projected
  it("assumptions prompt distinguishes target from achieved probability of success", () => {
    expect(ASSUMPTIONS_PROMPT).toMatch(
      /target.*(?:not|do not).*achieved|TARGET.*not.*(?:achieved|projected)|achieved.*not.*target/i
    );
  });

  // R5 (whole-branch review, I3 adjacent). The prompt used to enumerate
  // `moderate_conservative` and `moderate_aggressive`, neither of which is a
  // real `RiskLevel` — it taught the model two tokens nothing can consume.
  it("assumptions prompt names exactly the real RiskLevel values", () => {
    for (const level of RISK_LEVELS) {
      expect(ASSUMPTIONS_PROMPT).toContain(level);
    }
  });

  it("assumptions prompt names neither of the two invalid risk tokens", () => {
    expect(ASSUMPTIONS_PROMPT).not.toMatch(/\bmoderate_conservative\b/);
    expect(ASSUMPTIONS_PROMPT).not.toMatch(/\bmoderate_aggressive\b/);
  });
});
