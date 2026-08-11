import { describe, it, expect } from "vitest";
import { narratePlanInOnePage } from "../plan-in-one-page";
import { narrateWhatYouHave } from "../what-you-have";
import { narrateWhatWeRecommend } from "../what-we-recommend";
import { moneyFact, pctFact, type Fact } from "../../facts";
import type { StoryContext } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62 + Roth",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [
    { name: "Delay Social Security", rows: [{ area: "Income", what: "Alan's Social Security", op: "edit", before: "67", after: "70", detail: ["Claiming age moves from 67 to 70"] }] },
  ],
  facts: [
    pctFact("outcome.confidence.base", "Confidence, current plan", 0.73),
    pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.91),
    moneyFact("today.netWorth", "Net worth today", 2_100_000),
    moneyFact("today.assets", "What you own", 2_400_000),
    moneyFact("today.debts", "What you owe", 300_000),
  ],
};

/** Same context, with the confidence facts swapped for `facts`. */
function withConfidence(facts: Fact[]): StoryContext {
  return { ...CTX, facts: [...facts, ...CTX.facts.filter((f) => !f.id.startsWith("outcome.confidence."))] };
}

const BASE = pctFact("outcome.confidence.base", "Confidence, current plan", 0.73);
const PROPOSED = pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.91);

describe("deterministic chapter narratives", () => {
  it("plan-in-one-page leads with the confidence movement", () => {
    const lines = narratePlanInOnePage(CTX);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toContain("73%");
    expect(lines.join(" ")).toContain("91%");
  });

  it("what-you-have states owned, owed, and the difference", () => {
    const joined = narrateWhatYouHave(CTX).join(" ");
    expect(joined).toContain("$2.4M");
    expect(joined).toContain("$300K");
    expect(joined).toContain("$2.1M");
  });

  it("what-we-recommend names each strategy", () => {
    expect(narrateWhatWeRecommend(CTX).join(" ")).toContain("Delay Social Security");
  });

  it("every narrative uses only figures from the fact pack", async () => {
    const { runGates } = await import("../../validate");
    for (const lines of [narratePlanInOnePage(CTX), narrateWhatYouHave(CTX), narrateWhatWeRecommend(CTX)]) {
      const factFailures = runGates(lines.join(" "), CTX.facts).filter((f) => f.gate === "facts");
      expect(factFailures).toEqual([]);
    }
  });

  it("plan-in-one-page omits the comparison when there is no proposal", () => {
    const joined = narratePlanInOnePage({ ...CTX, hasProposal: false, strategies: [] }).join(" ");
    expect(joined).not.toContain("91%");
  });
});

// Base and proposed Monte Carlo runs fail independently in production, so every
// combination of the two confidence facts is a pack the fallback really receives.
describe("plan-in-one-page confidence combinations", () => {
  it("names the direction of the move when both runs are present", () => {
    expect(narratePlanInOnePage(CTX)[0]).toBe(
      "With the changes we're suggesting, the plan comes through in 91% of the futures we tested — up from 73% on your current path.",
    );
  });

  it("says so plainly when the proposal lowers confidence", () => {
    const ctx = withConfidence([
      pctFact("outcome.confidence.base", "Confidence, current plan", 0.91),
      pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.73),
    ]);
    expect(narratePlanInOnePage(ctx)[0]).toBe(
      "With the changes we're suggesting, the plan comes through in 73% of the futures we tested — down from 91% on your current path.",
    );
  });

  it("does not claim a move when the two runs land in the same place", () => {
    const ctx = withConfidence([
      pctFact("outcome.confidence.base", "Confidence, current plan", 0.73),
      pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.73),
    ]);
    expect(narratePlanInOnePage(ctx)[0]).toBe(
      "With the changes we're suggesting, the plan comes through in 73% of the futures we tested — no change from your current path.",
    );
  });

  // PLAN DEFECT #3: the brief's `if (hasProposal && base && proposed) … else if (base)`
  // emits NO confidence line at all for a proposed-only pack.
  it("still states confidence when only the proposed run finished", () => {
    const ctx = withConfidence([PROPOSED]);
    const joined = narratePlanInOnePage(ctx).join(" ");
    expect(joined).toContain("91%");
    expect(narratePlanInOnePage(ctx)[0]).toBe(
      "With the changes we're suggesting, the plan comes through in 91% of the futures we tested.",
    );
  });

  it("states the current path when only the base run finished", () => {
    const ctx = withConfidence([BASE]);
    expect(narratePlanInOnePage(ctx)[0]).toBe(
      "On your current path, the plan comes through in 73% of the futures we tested.",
    );
  });

  it("drops the confidence line, but not the chapter, when neither run finished", () => {
    const ctx = withConfidence([]);
    const joined = narratePlanInOnePage(ctx).join(" ");
    expect(joined).not.toContain("%");
    expect(joined).toContain("$2.1M");
  });

  // The fallback is what the client reads when the AI is off. It may never be blank.
  it("never returns an empty chapter, even with nothing in the fact pack", () => {
    const lines = narratePlanInOnePage({ ...CTX, facts: [], strategies: [], hasProposal: false });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ").trim().length).toBeGreaterThan(0);
  });
});

describe("what-we-recommend keeps ungrounded figures off the page", () => {
  // Verbatim shape of a real savings_rule edit detail — see
  // src/lib/presentations/pages/scenario-changes/describe/__tests__/savings.test.ts,
  // which pins `detail` as "Annual amount: $20k → $25k".
  const SAVINGS_EDIT: StoryContext = {
    ...CTX,
    strategies: [
      {
        name: "Boost the 401(k)",
        rows: [{ area: "Savings", what: "401(k) contribution", op: "edit", before: "—", after: "Updated", detail: ["Annual amount: $20k → $25k"] }],
      },
    ],
  };

  it("drops a detail carrying figures that are not in the fact pack", () => {
    const joined = narrateWhatWeRecommend(SAVINGS_EDIT).join(" ");
    expect(joined).not.toContain("$20k");
    expect(joined).not.toContain("$25k");
    expect(joined).toBe("Boost the 401(k) — this changes what you're saving.");
  });

  it("passes the facts gate on a detail full of another module's figures", async () => {
    const { runGates } = await import("../../validate");
    const failures = runGates(narrateWhatWeRecommend(SAVINGS_EDIT).join(" "), SAVINGS_EDIT.facts);
    expect(failures.filter((f) => f.gate === "facts")).toEqual([]);
  });

  it("keeps a figure-free detail exactly as written", () => {
    expect(narrateWhatWeRecommend(CTX)).toEqual(["Delay Social Security — Claiming age moves from 67 to 70."]);
  });

  it("keeps a detail whose figures are all in the fact pack", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Spend the surplus", rows: [{ area: "Expenses", what: "Living expenses", op: "edit", before: "—", after: "Updated", detail: ["Net worth today is $2.1M"] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Spend the surplus — Net worth today is $2.1M."]);
  });

  // Every whyAdd/whyRemove/whyEdit string in scenario-changes/describe/specs.ts
  // already ends in a period, and `editRow` puts whyEdit straight into detail[0]
  // for every single-field edit — the most common change there is.
  it("does not double the full stop on a detail that is already a sentence", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Trim the gift", rows: [{ area: "Estate", what: "Annual gift", op: "edit", before: "$18k", after: "$12k", detail: ["Adjusts this gift."] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Trim the gift — Adjusts this gift."]);
  });

  it("names the strategy when the row carries no detail at all", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Sell the rental", rows: [{ area: "Assets", what: "Rental property", op: "remove", before: "In plan", after: "Removed", detail: [] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Sell the rental — this changes your accounts."]);
  });

  it("says nothing is changing when there is no proposal", () => {
    expect(narrateWhatWeRecommend({ ...CTX, hasProposal: false, strategies: [] })).toEqual([
      "We aren't suggesting changes to the plan this time.",
    ]);
  });
});

describe("what-you-have degrades to net worth alone", () => {
  it("still says something when only the net-worth fact is present", () => {
    const ctx: StoryContext = { ...CTX, facts: [moneyFact("today.netWorth", "Net worth today", 2_100_000)] };
    const joined = narrateWhatYouHave(ctx).join(" ");
    expect(joined).toContain("$2.1M");
    expect(joined).not.toContain("$2.4M");
  });

  it("never returns an empty chapter", () => {
    expect(narrateWhatYouHave({ ...CTX, facts: [] }).join(" ").trim().length).toBeGreaterThan(0);
  });
});
