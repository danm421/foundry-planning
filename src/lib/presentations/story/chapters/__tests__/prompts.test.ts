import { describe, it, expect } from "vitest";
import { buildChapterPrompt } from "../prompts";
import { CHAPTERS, chapterEnumerates } from "../registry";
import { moneyFact, pctFact, quotedFact } from "../../facts";
import { runGates } from "../../validate";
import { CHAPTER_IDS, type StoryContext } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62 + Roth",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [{ name: "Delay Social Security", rows: [{ area: "Income", what: "Alan's Social Security", op: "edit", before: "67", after: "70", detail: ["Claiming age moves from 67 to 70"] }] }],
  facts: [pctFact("outcome.confidence.proposed", "Confidence, proposed", 0.91), moneyFact("today.netWorth", "Net worth", 2_100_000)],
};

describe("buildChapterPrompt", () => {
  it("lists every allowed figure with its label, and forbids inventing others", () => {
    const { system, user } = buildChapterPrompt("planInOnePage", CTX, [], []);
    expect(user).toContain("Confidence, proposed: 91%");
    expect(user).toContain("Net worth: $2.1M");
    expect(system).toContain("Only use the figures listed");
  });

  it("names the household and the scenario", () => {
    const { user } = buildChapterPrompt("planInOnePage", CTX, [], []);
    expect(user).toContain("Alan and Teresa");
    expect(user).toContain("Retire at 62 + Roth");
  });

  it("includes the strategies for the recommendation chapter", () => {
    const { user } = buildChapterPrompt("whatWeRecommend", CTX, [], []);
    expect(user).toContain("Delay Social Security");
    expect(user).toContain("Claiming age moves from 67 to 70");
  });

  it("tells the model to point forward in frontMatter mode", () => {
    const { system } = buildChapterPrompt("planInOnePage", { ...CTX, documentRole: "frontMatter" }, [], []);
    expect(system).toContain("pages that follow");
  });

  it("includes voice samples as style examples when supplied", () => {
    const { system } = buildChapterPrompt("planInOnePage", CTX, ["We kept this simple on purpose."], []);
    expect(system).toContain("We kept this simple on purpose.");
  });

  it("names every broken rule on a retry", () => {
    const { user } = buildChapterPrompt("planInOnePage", CTX, [], [
      { gate: "facts", message: "The figure $3.4M is not one of the supplied plan figures." },
      { gate: "voice", message: "Drop the three-item parallel list." },
    ]);
    expect(user).toContain("$3.4M");
    expect(user).toContain("three-item");
  });

  // Gate 3 rejects any clause that OPENS with an action verb, and it applies no
  // object test in that position — so "Sell the rental", an advisor's own name
  // for a toggle group, fails the gate for words the model did not choose. The
  // label still has to reach the model (it is how the changes are grouped), so
  // the prompt supplies it and forbids reproducing it.
  it("supplies a verb-initial strategy label but forbids quoting it", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Sell the rental", rows: [{ area: "Assets", what: "Rental property", op: "remove", before: "In plan", after: "—", detail: ["Sold in 2029"] }] }],
    };
    const { system, user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
    expect(user).toContain("Sell the rental");
    expect(system).toContain("never repeat a label word for word");
  });

  // Gate 3's own list, `ACTION_VERBS` (validate/readability.ts). It is private
  // to that module and this suite may not export it, so the copy is pinned
  // instead: every word below is proved to be one the gate really rejects, and
  // proved to be named in the prompt.
  const GATE_3_VERBS = ["buy", "sell", "purchase", "liquidate", "move", "switch", "shift", "trim", "rebalance", "reallocate", "convert", "roll", "invest"];

  it("names every action word Gate 3 rejects at the head of a clause", () => {
    const { system } = buildChapterPrompt("whatWeRecommend", CTX, [], []);
    const line = system.split("\n").find((l) => l.startsWith("Never open a sentence or a clause"));
    expect(line).toBeDefined();
    for (const verb of GATE_3_VERBS) {
      const opener = `${verb[0].toUpperCase()}${verb.slice(1)} the position and the plan still holds.`;
      expect(runGates(opener, CTX.facts).map((f) => f.gate)).toContain("advice");
      expect(line).toContain(verb);
    }
    // …and the shape the prompt asks for instead survives the same gate.
    expect(runGates("The plan sells the position, and your confidence holds.", CTX.facts)).toEqual([]);
  });

  it("names Gate 2's sentence-length limits, and the gate holds those numbers", () => {
    const { system } = buildChapterPrompt("planInOnePage", CTX, [], []);
    expect(system).toContain("under 20 words");
    expect(system).toContain("past 40");
    const readability = (text: string) => runGates(text, CTX.facts).filter((f) => f.gate === "readability");
    // 41 words in one sentence — the per-sentence cap, not the average.
    expect(readability(`${"word ".repeat(40)}end.`)).not.toEqual([]);
    // Three sentences of 22 — each under the cap, the average over the limit.
    expect(readability(`${"word ".repeat(21)}end. `.repeat(3))).not.toEqual([]);
    // …and prose inside both numbers passes, so neither check above is vacuous.
    expect(readability("Your plan holds. We modelled it against a rough decade and it still lands where you want it to.")).toEqual([]);
  });

  /**
   * The prompt names ONE mean to every chapter — the tight one — and the
   * enumerating chapter's gate sits looser than it. That direction is safe and
   * deliberate (see the comment on the sentence in `prompts.ts`); the OPPOSITE
   * direction is the failure that matters, because a gate tighter than the
   * prompt rejects a chapter for a rule the model was never given.
   *
   * So the invariant, asserted against the gate's BEHAVIOUR rather than against
   * a constant: prose that does exactly what the prompt asks for clears the
   * gate — on every chapter, whichever way either number is next edited.
   */
  it("asks for a mean no chapter's gate will then reject it for", () => {
    const asked = `${"word ".repeat(19)}end. `.repeat(3); // 20 words a sentence
    for (const chapterId of CHAPTER_IDS) {
      const { system } = buildChapterPrompt(chapterId, CTX, [], []);
      expect(system).toContain("under 20 words");
      expect(system).toContain("past 40");
      const opts = { enumerates: chapterEnumerates(chapterId) };
      expect(runGates(asked, CTX.facts, opts).filter((f) => f.gate === "readability")).toEqual([]);
    }
  });

  it("gives the enumerating chapter the looser gate as headroom, not as a target", () => {
    const readability = (text: string, enumerates: boolean) =>
      runGates(text, CTX.facts, { enumerates }).filter((f) => f.gate === "readability");
    const mean24 = `${"word ".repeat(23)}end. `.repeat(3);
    // Four words past what it was asked for, and still published rather than
    // thrown away for the deterministic list of the advisor's own labels.
    expect(readability(mean24, true)).toEqual([]);
    expect(readability(mean24, false)).not.toEqual([]);
    // The headroom is finite, and the per-sentence cap never moved.
    expect(readability(`${"word ".repeat(25)}end. `.repeat(3), true)).not.toEqual([]);
    expect(readability(`${"word ".repeat(40)}end.`, true)).not.toEqual([]);
  });

  // The other half of the same trade. The chapter that has to name every account
  // a household owns was being told never to write a three-item list.
  it("lets the enumerating chapter list things, and still bans the flourish", () => {
    const { system } = buildChapterPrompt("whatWeRecommend", CTX, [], []);
    expect(system).toContain("three-item parallel list of qualities");
    expect(system).toContain("listing what they own");
    // The prose chapters keep the flat rule.
    expect(buildChapterPrompt("planInOnePage", CTX, [], []).system).toContain(
      "Never write a three-item parallel list.",
    );
  });

  it("names each change's operation, and quotes only figures the fact pack supplied", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [
        {
          name: "Sell the rental",
          rows: [
            { area: "Assets", what: "Rental property", op: "remove", before: "In plan", after: "—", detail: ["Sold in 2029 · $850k"] },
            { area: "Taxes", what: "Roth conversion", op: "add", before: "—", after: "Added", detail: [] },
            { area: "Assets", what: "Portfolio", op: "edit", before: "$2.0M", after: "$2.1M", detail: ["Ends at $2.1M"] },
          ],
        },
      ],
    };
    const { user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
    // The op word carries the change even when the row has nothing else.
    expect(user).toContain("Rental property (removed)");
    expect(user).toContain("Roth conversion (added)");
    // A year and a foreign-formatted dollar are both figures under Gate 1.
    expect(user).not.toContain("2029");
    expect(user).not.toContain("$850k");
    expect(user).not.toContain("$2.0M");
    // …and a detail whose figure IS in the pack survives, so the filter is not
    // just "drop anything with a number in it".
    expect(user).toContain("Portfolio (raised) — Ends at $2.1M");
    expect(runGates(user, ctx.facts).filter((f) => f.gate === "facts")).toEqual([]);
  });

  it("keeps a grounded before → after, and says which way a suppressed one moved", () => {
    const ctx: StoryContext = {
      ...CTX,
      facts: [...CTX.facts, pctFact("outcome.confidence.base", "Confidence, current plan", 0.73)],
      strategies: [
        {
          name: "Delay Social Security",
          rows: [
            // Both sides are the pack's own spellings, so the values reach the model.
            { area: "Plan & Assumptions", what: "Confidence", op: "edit", before: "73%", after: "91%", detail: [] },
            // The single-field edit path: `fmtValue` spelling, never the pack's.
            { area: "Savings", what: "Annual amount", op: "edit", before: "$1.5k", after: "$2.0k", detail: ["Changes what you're saving."] },
            { area: "Income", what: "Salary end year", op: "edit", before: "2032", after: "2028", detail: [] },
          ],
        },
      ],
    };
    const { user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
    expect(user).toContain("Confidence (raised): 73% → 91%");
    expect(user).toContain("Annual amount (raised) — Changes what you're saving.");
    expect(user).toContain("Salary end year (moved earlier)");
    // The direction survives; the foreign spellings do not.
    expect(user).not.toContain("$1.5k");
    expect(user).not.toContain("$2.0k");
    expect(user).not.toContain("2032");
  });

  it("drops a before/after pair that names nothing", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [
        {
          name: "Rework the savings plan",
          // The multi-field edit path — `before`/`after` are "— → Updated".
          rows: [{ area: "Expenses", what: "Living expenses", op: "edit", before: "—", after: "Updated", detail: ["Annual amount: $20k → $25k"] }],
        },
      ],
    };
    const { user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
    expect(user).toContain("- Living expenses (changed)");
    expect(user).not.toContain("Updated");
    expect(user).not.toContain("$20k");
  });

  /**
   * A figure can be GROUNDED and still be written in a form this deck never
   * uses. `compactCurrency` renders a negative as "($50k)" and `extractFigures`
   * returns "$50k" from it with the parens stripped, so a "$50k" quoted
   * legitimately from another change grounds the parenthesised one — token
   * membership alone cannot see the difference.
   *
   * This block is background for the model rather than client-facing text, but
   * what the model is shown is what the model writes, so it is held to the same
   * rule as `what-we-recommend.ts`. Both places the parens can land are covered:
   * inside `detail[0]` (a multi-field edit) and in the `before`/`after` pair (a
   * single-field one).
   */
  describe("refuses an accounting-paren negative in the strategy block", () => {
    /** Both rows are the verbatim output of an `expense` edit with
     *  `annualAmount: { from: -50_000, to: -20_000 }` — multi-field (parens in
     *  the detail) and single-field (parens in the pair). */
    const ctx: StoryContext = {
      ...CTX,
      // The tokens really are in the pack, quoted from other changes.
      facts: [
        ...CTX.facts,
        quotedFact("quoted.$50k", 'Roth ladder — from "$50k/yr …"', "$50k", ["whatWeRecommend"]),
        quotedFact("quoted.$20k", 'Boost the 401(k) — from "… $20k → $25k"', "$20k", ["whatWeRecommend"]),
      ],
      strategies: [
        {
          name: "Trim the negative expense",
          rows: [{ area: "Expenses", what: "Travel", op: "edit", before: "—", after: "Updated", detail: ["Annual amount: ($50k) → ($20k)"] }],
        },
        {
          name: "Halve the negative expense",
          rows: [{ area: "Expenses", what: "Travel · Annual amount", op: "edit", before: "($50k)", after: "($20k)", detail: ["Adjusts this expense."] }],
        },
      ],
    };

    it("keeps the banned form out of the prompt from either field", () => {
      const { user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
      expect(user).not.toContain("($50k)");
      expect(user).not.toContain("($20k)");
    });

    it("keeps the operation word, so no row is left a bare noun", () => {
      const { user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
      // The pair is suppressed; the direction read off it is not — `editWord`
      // runs before the quotability check for exactly this reason.
      expect(user).toContain("- Travel · Annual amount (raised) — Adjusts this expense.");
      // The multi-field row keeps its noun and its operation. It carries nothing
      // else, which is the state it was in before any of this was quotable.
      expect(user).toContain("- Travel (changed)");
    });

    it("still shows a pair written the way the deck writes one", () => {
      const clean: StoryContext = {
        ...ctx,
        facts: [
          ...CTX.facts,
          quotedFact("quoted.$100k", 'Spend more on travel — from "$100k → $150k"', "$100k", ["whatWeRecommend"]),
          quotedFact("quoted.$150k", 'Spend more on travel — from "$100k → $150k"', "$150k", ["whatWeRecommend"]),
        ],
        strategies: [
          {
            name: "Spend more on travel",
            rows: [{ area: "Expenses", what: "Travel · Annual amount", op: "edit", before: "$100k", after: "$150k", detail: ["Adjusts this expense."] }],
          },
        ],
      };
      const { user } = buildChapterPrompt("whatWeRecommend", clean, [], []);
      expect(user).toContain("- Travel · Annual amount (raised): $100k → $150k — Adjusts this expense.");
    });
  });

  it("leaves no heading standing over an empty list", () => {
    const { user } = buildChapterPrompt("whatWeRecommend", { ...CTX, strategies: [], facts: [] }, [], []);
    expect(user).not.toContain("The changes, grouped as strategies");
    expect(user).not.toMatch(/figures you may use:\n\n/u);
  });
});

describe("the register rules", () => {
  it("tells the model the fact labels are not English", () => {
    const { system } = buildChapterPrompt("whatYouHave", CTX, [], []);
    expect(system).toMatch(/heading|label/i);
    expect(system).toContain("never copy");
  });

  it("forbids describing the page", () => {
    const { system } = buildChapterPrompt("whatYouHave", CTX, [], []);
    expect(system).toMatch(/never mention the page/i);
  });

  it("pins the names to direct address", () => {
    const { system } = buildChapterPrompt("whatYouHave", CTX, [], []);
    expect(system).toMatch(/address them directly/i);
  });

  it("labels the fact table as internal notes rather than as figures to quote", () => {
    const { user } = buildChapterPrompt("whatYouHave", CTX, [], []);
    // The heading before the list is what invited the transcription.
    expect(user).toContain("The left of each line is our own note");
  });

  /**
   * The brief is written FOR the model ("This is the page that gets read when
   * nothing else does") and the 2026-08-12 read found it paraphrased onto the
   * client's page as "This page is the punchline." Saying whose words they are,
   * where they are handed over, is the cheapest half of that fix.
   */
  it("marks the chapter brief as instructions the client never sees", () => {
    const { user } = buildChapterPrompt("planInOnePage", CTX, [], []);
    expect(user).toMatch(/never sees/i);
  });
});

describe("CHAPTERS", () => {
  it("gives every chapter a title, a layout, and a fallback narrator", () => {
    for (const def of Object.values(CHAPTERS)) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(["heroProse", "strategyCards"]).toContain(def.layout);
      expect(typeof def.narrate).toBe("function");
    }
  });
});
