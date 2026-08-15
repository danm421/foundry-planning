import { describe, it, expect } from "vitest";
import { narratePlanInOnePage } from "../plan-in-one-page";
import { narrateWhatYouHave } from "../what-you-have";
import { narrateWhatWeRecommend } from "../what-we-recommend";
import { moneyFact, pctFact, quotedFact, type Fact } from "../../facts";
import type { StoryContext, StoryStrategy } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62 + Roth",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [
    { name: "Delay Social Security", rows: [{ area: "Income", what: "Alan's Social Security", op: "edit", before: "67", after: "70", detail: ["Claiming age moves from 67 to 70"] }] },
  ],
  goals: [],
  facts: [
    pctFact("outcome.confidence.base", "Confidence, current plan", 0.73),
    pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.91),
    moneyFact("today.netWorth", "Net worth today", 2_100_000),
    moneyFact("today.assets", "What you own", 2_400_000),
    moneyFact("today.debts", "What you owe", 300_000),
  ],
};

const BASE = pctFact("outcome.confidence.base", "Confidence, current plan", 0.73);
const PROPOSED = pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.91);
const BALANCE_SHEET = CTX.facts.filter((f) => !f.id.startsWith("outcome.confidence."));

/** CTX with the confidence facts replaced, so each Monte Carlo outcome is a pack. */
function withConfidence(facts: Fact[]): StoryContext {
  return { ...CTX, facts: [...facts, ...BALANCE_SHEET] };
}

function strategy(name: string): StoryStrategy {
  return { name, rows: [{ area: "Income", what: name, op: "edit", before: "—", after: "Updated", detail: [] }] };
}

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

/**
 * Base and proposed Monte Carlo runs fail independently, so all four combinations
 * are real production packs. Every case asserts the JOINED CHAPTER, not `lines[0]`:
 * a sentence that is correct alone can still misstate the plan once the two lines
 * after it are appended, which is exactly how the "That comes from…" defect got in.
 */
describe("plan-in-one-page reads correctly as a whole chapter", () => {
  it("both runs finished: attributes the movement to the changes", () => {
    expect(narratePlanInOnePage(CTX).join(" ")).toBe(
      "With the changes we're suggesting, the plan comes through in 91% of the futures we tested — up from 73% on your current path. " +
        "That comes from one change: Delay Social Security. " +
        "You're starting from $2.1M.",
    );
  });

  // The current-path number must never be attributed to the recommended change.
  it("base only: does not credit the current-path number to the change", () => {
    const joined = narratePlanInOnePage(withConfidence([BASE])).join(" ");
    expect(joined).toBe(
      "On your current path, the plan comes through in 73% of the futures we tested. " +
        "We're recommending one change: Delay Social Security. " +
        "You're starting from $2.1M.",
    );
    expect(joined).not.toContain("That comes from");
  });

  it("proposed only: still states confidence, and does not echo itself", () => {
    const joined = narratePlanInOnePage(withConfidence([PROPOSED])).join(" ");
    expect(joined).toBe(
      "With the changes we're suggesting, the plan comes through in 91% of the futures we tested. " +
        "We're recommending one change: Delay Social Security. " +
        "You're starting from $2.1M.",
    );
    expect(joined).toContain("91%");
  });

  // A pronoun with no antecedent is how the chapter used to open here.
  it("neither run finished: opens on a subject, not a dangling pronoun", () => {
    const joined = narratePlanInOnePage(withConfidence([])).join(" ");
    expect(joined).toBe(
      "We're recommending one change: Delay Social Security. You're starting from $2.1M.",
    );
    expect(joined).not.toMatch(/^That /);
    expect(joined).not.toContain("%");
  });

  it("both runs, no strategies: no orphan attribution sentence", () => {
    expect(narratePlanInOnePage({ ...CTX, strategies: [] }).join(" ")).toBe(
      "With the changes we're suggesting, the plan comes through in 91% of the futures we tested — up from 73% on your current path. " +
        "You're starting from $2.1M.",
    );
  });

  it("no proposal: the proposed fact is ignored even when the pack carries it", () => {
    expect(narratePlanInOnePage({ ...CTX, hasProposal: false, strategies: [] }).join(" ")).toBe(
      "On your current path, the plan comes through in 73% of the futures we tested. You're starting from $2.1M.",
    );
  });

  it("never returns an empty chapter, even with nothing in the fact pack", () => {
    expect(narratePlanInOnePage({ ...CTX, facts: [], strategies: [], hasProposal: false })).toEqual([
      "Here's where your plan stands today, and what it looks like from here.",
    ]);
  });
});

describe("plan-in-one-page confidence direction", () => {
  it("says so plainly when the proposal lowers confidence", () => {
    const ctx = withConfidence([
      pctFact("outcome.confidence.base", "Confidence, current plan", 0.91),
      pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.73),
    ]);
    expect(narratePlanInOnePage(ctx)[0]).toBe(
      "With the changes we're suggesting, the plan comes through in 73% of the futures we tested — down from 91% on your current path.",
    );
  });

  // A stated non-movement is still not something the changes can be credited
  // with, so the attribution sentence may not follow it — the same class of
  // defect as the base-only case, one branch further in.
  it("does not attribute a non-movement to the changes", () => {
    const ctx = withConfidence([BASE, pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 0.73)]);
    const joined = narratePlanInOnePage(ctx).join(" ");
    expect(joined).toBe(
      "With the changes we're suggesting, the plan comes through in 73% of the futures we tested — no change from your current path. " +
        "We're recommending one change: Delay Social Security. " +
        "You're starting from $2.1M.",
    );
    expect(joined).not.toContain("That comes from");
  });

  /**
   * The page shows `display`, so the sentence has to agree with what the client
   * can SEE. Two runs with different trial counts (543/744 against a flat 0.73)
   * differ in `raw` and round to the same "73%" — reading direction off `raw`
   * alone prints "down from 73%" beside "73%".
   */
  it("claims no move when the two runs print the same percentage", () => {
    const proposed = pctFact("outcome.confidence.proposed", "Confidence, proposed plan", 543 / 744);
    expect(proposed.display).toBe(BASE.display);
    expect(proposed.raw).not.toBe(BASE.raw);
    const joined = narratePlanInOnePage(withConfidence([BASE, proposed])).join(" ");
    expect(joined).toBe(
      "With the changes we're suggesting, the plan comes through in 73% of the futures we tested — no change from your current path. " +
        "We're recommending one change: Delay Social Security. " +
        "You're starting from $2.1M.",
    );
  });

  /**
   * A `quotedFact` carries no `raw`, so two figures can differ and still be
   * unorderable. Saying "no change" beside 73% and 91% would be false, and
   * picking a direction would be a guess: state the pair, drop the direction
   * word, and withhold the attribution sentence — there is no named movement to
   * credit.
   *
   * The app cannot currently BUILD this state, and the test says so honestly:
   * `buildStoryFacts` only ever makes the confidence facts with `pctFact`, which
   * always carries a number, and every `quotedFact` id begins "quoted.". The
   * branch exists because widening `raw` to `number | null` makes the null case
   * reachable to the type system, and the alternative — letting it fall into
   * "no change" — would print a falsehood the day anything does produce it. The
   * fact below is therefore constructed by hand, deliberately.
   */
  it("states both figures without a direction when one carries no number", () => {
    const proposed = quotedFact("outcome.confidence.proposed", "Confidence, proposed plan", "91%", [
      "planInOnePage",
    ]);
    const joined = narratePlanInOnePage(withConfidence([BASE, proposed])).join(" ");
    expect(joined).toBe(
      "With the changes we're suggesting, the plan comes through in 91% of the futures we tested — against 73% on your current path. " +
        "We're recommending one change: Delay Social Security. " +
        "You're starting from $2.1M.",
    );
    expect(joined).not.toContain("That comes from");
    expect(joined).not.toContain("no change");
  });
});

describe("plan-in-one-page counts changes the way an advisor writes them", () => {
  it("spells the count and joins two names with 'and'", () => {
    const ctx = { ...CTX, strategies: [strategy("Delay Social Security"), strategy("Sell the rental")] };
    expect(narratePlanInOnePage(ctx)[1]).toBe(
      "That comes from two changes: Delay Social Security and Sell the rental.",
    );
  });

  it("uses a serial comma for three or more", () => {
    const ctx = { ...CTX, strategies: [strategy("Delay Social Security"), strategy("Sell the rental"), strategy("Boost the 401(k)")] };
    expect(narratePlanInOnePage(ctx)[1]).toBe(
      "That comes from three changes: Delay Social Security, Sell the rental, and Boost the 401(k).",
    );
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

  /**
   * The fact gate folds case (validate/facts.ts figureKey uppercases), so the
   * table's "$850k" satisfies a "$850K" fact. Both spellings would then appear in
   * one deck — the inconsistency this module exists to prevent. The figure has to
   * match the fact pack's SPELLING, not just its value.
   */
  it("rejects a figure whose value is grounded but whose spelling is not ours", () => {
    const ctx: StoryContext = {
      ...CTX,
      facts: [...CTX.facts, moneyFact("proposal.saleProceeds", "Sale proceeds", 850_000)],
      strategies: [{ name: "Sell the rental", rows: [{ area: "Assets", what: "Rental property", op: "add", before: "—", after: "Added", detail: ["Sale proceeds of $850k"] }] }],
    };
    expect(ctx.facts.at(-1)?.display).toBe("$850K");
    const joined = narrateWhatWeRecommend(ctx).join(" ");
    expect(joined).not.toContain("$850k");
    expect(joined).toBe("Sell the rental — this changes what you own.");
  });

  it("keeps a figure spelled exactly as the fact pack spells it", () => {
    const ctx: StoryContext = {
      ...CTX,
      facts: [...CTX.facts, moneyFact("proposal.saleProceeds", "Sale proceeds", 850_000)],
      strategies: [{ name: "Sell the rental", rows: [{ area: "Assets", what: "Rental property", op: "add", before: "—", after: "Added", detail: ["Sale proceeds of $850K"] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Sell the rental — Sale proceeds of $850K."]);
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

  it.each([
    ["Adjusts this gift!", "Trim the gift — Adjusts this gift."],
    ["Adjusts this gift?", "Trim the gift — Adjusts this gift."],
    ["Adjusts this gift…", "Trim the gift — Adjusts this gift."],
    ["Adjusts this gift ", "Trim the gift — Adjusts this gift."],
  ])("closes %j with exactly one full stop", (detail, expected) => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Trim the gift", rows: [{ area: "Estate", what: "Annual gift", op: "edit", before: "—", after: "Updated", detail: [detail] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual([expected]);
  });

  /**
   * "—" is the describers' null marker, not punctuation: `fmtValue`, `label` and
   * `recipients` all return it for a null field, so it reaches `detail` as a
   * VALUE. Both shapes below are figure-free, so the fact gate waves them
   * through — nothing but this rule keeps them off the page.
   */
  it.each([
    // describe/kinds/estate.ts bequestLine(), with no recipients resolved
    ["All remaining assets → —", "Estate", "Update the will — this changes your estate plan."],
    // describe/registry.ts simpleDescriber add path, unlabelled entity type
    ["—", "Estate", "Update the will — this changes your estate plan."],
  ] as const)("degrades the unresolved detail %j rather than quoting it", (detail, area, expected) => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Update the will", rows: [{ area, what: "Will", op: "edit", before: "—", after: "Updated", detail: [detail] }] }],
    };
    const joined = narrateWhatWeRecommend(ctx).join(" ");
    expect(joined).toBe(expected);
    expect(joined).not.toMatch(/—\s*\.$/u);
  });

  it("keeps an em dash that is punctuation rather than a missing value", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Update the will", rows: [{ area: "Estate", what: "Will", op: "edit", before: "—", after: "Updated", detail: ["All remaining assets — split evenly"] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Update the will — All remaining assets — split evenly."]);
  });

  it("calls the Assets area what you own — it covers property, not just accounts", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Sell the rental", rows: [{ area: "Assets", what: "Rental property", op: "remove", before: "In plan", after: "Removed", detail: [] }] }],
    };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Sell the rental — this changes what you own."]);
  });

  it("names the strategy on its own when it carries no rows at all", () => {
    const ctx: StoryContext = { ...CTX, strategies: [{ name: "Delay Social Security", rows: [] }] };
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Delay Social Security."]);
  });

  it("says nothing is changing when there is no proposal", () => {
    expect(narrateWhatWeRecommend({ ...CTX, hasProposal: false, strategies: [] })).toEqual([
      "We aren't suggesting changes to the plan this time.",
    ]);
  });
});

describe("narrateWhatWeRecommend — internal change text never reaches the client", () => {
  /** Every one of these is a real string read off a client's exported PDF on
   *  2026-08-14. The middot and the arrow are the Scenario Changes table's own
   *  separators; the parenthesised words are its milestone refs. */
  const LEAKED = [
    "Susan - 401k · 10% of salary",
    "Retirement Living Expenses · Annual amount",
    "Roth percent: — → 100%",
    "Sell rental (Plan Start)",
    "Convert IRA (Client Retirement)",
  ];

  it.each(LEAKED)("does not print %s", (name) => {
    const out = narrateWhatWeRecommend({
      ...CTX,
      hasProposal: true,
      strategies: [{ name, rows: [{ what: "Annual amount", area: "Savings", op: "edit", before: "—", after: "—", detail: [] }] }],
    });
    const text = out.join(" ");
    expect(text).not.toContain("·");
    expect(text).not.toContain("→");
    expect(text).not.toMatch(/\((?:Plan Start|Client Retirement)\)/u);
  });

  it("still names a clean strategy label, because that is what the client recognises", () => {
    const out = narrateWhatWeRecommend({
      ...CTX,
      hasProposal: true,
      strategies: [{ name: "Delay Social Security", rows: [{ what: "Claim age", area: "Income", op: "edit", before: "—", after: "—", detail: [] }] }],
    });
    expect(out.join(" ")).toContain("Delay Social Security");
  });

  it("falls back to the area phrase when a label is unusable, never to silence", () => {
    const out = narrateWhatWeRecommend({
      ...CTX,
      hasProposal: true,
      strategies: [{ name: "Susan - 401k · 10% of salary", rows: [{ what: "Annual amount", area: "Savings", op: "edit", before: "—", after: "—", detail: [] }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("One change adjusts what you're saving.");
  });
});

describe("what-you-have reads as a whole chapter", () => {
  const CAVEAT =
    "Not all of what you own is available to spend. Your home and anything held for someone else sit outside the money the plan draws on.";

  /** Just the balance-sheet facts named, so a partial pack is a real pack. */
  function balanceSheet(ids: string[]): StoryContext {
    return { ...CTX, facts: BALANCE_SHEET.filter((f) => ids.includes(f.id)) };
  }

  const A = "today.assets";
  const D = "today.debts";
  const N = "today.netWorth";
  const DISPLAY: Record<string, string> = { [A]: "$2.4M", [D]: "$300K", [N]: "$2.1M" };

  /**
   * All eight combinations. The two sides and the net are separate facts, so a
   * total can fail while its components succeed — a sequential `if` chain that
   * checks `net` before the sides silently drops a figure the pack holds, which
   * is what this table exists to stop happening again.
   */
  const COMBINATIONS: Array<[string[], string]> = [
    [[A, D, N], `You own $2.4M and owe $300K. The difference — $2.1M — is what the plan works with. ${CAVEAT}`],
    [[A, D], `You own $2.4M and owe $300K. ${CAVEAT}`],
    [[A, N], `You own $2.4M, and your net worth today is $2.1M. ${CAVEAT}`],
    [[D, N], `You owe $300K, and your net worth today is $2.1M. ${CAVEAT}`],
    [[A], `You own $2.4M. ${CAVEAT}`],
    // No figure for what they own, so the caveat has nothing to qualify.
    [[D], "You owe $300K."],
    [[N], `Your net worth today is $2.1M. ${CAVEAT}`],
    [[], "Your plan starts from what you own, set against what you owe. We don't have those figures to show here."],
  ];

  it.each(COMBINATIONS)("reads correctly for the pack %j", (ids, expected) => {
    expect(narrateWhatYouHave(balanceSheet(ids)).join(" ")).toBe(expected);
  });

  // The property behind the table: whatever the pack holds, the chapter says it.
  it("never drops a figure the pack holds", () => {
    for (const [ids] of COMBINATIONS) {
      const joined = narrateWhatYouHave(balanceSheet(ids)).join(" ");
      for (const id of ids) expect(joined).toContain(DISPLAY[id]);
    }
  });

  // The pronoun no longer depends on which figure the opening happened to name.
  it("never leans on a bare 'it' for its antecedent", () => {
    for (const [ids] of COMBINATIONS) {
      expect(narrateWhatYouHave(balanceSheet(ids)).join(" ")).not.toContain("Not all of it");
    }
  });

  // Nothing is known in the last case, so the chapter may not assert a balance
  // sheet, and it may not caveat a total it never printed.
  it("says plainly that there is nothing to total when the pack is empty", () => {
    expect(narrateWhatYouHave({ ...CTX, facts: [] }).join(" ")).not.toContain("Not all of");
  });
});
