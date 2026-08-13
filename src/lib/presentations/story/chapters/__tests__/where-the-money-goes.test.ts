import { describe, it, expect } from "vitest";
import { narrateWhereTheMoneyGoes } from "../where-the-money-goes";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { moneyFact, type Fact } from "../../facts";
import type { StoryContext } from "../../types";

function ctxWith(facts: Fact[]): StoryContext {
  return {
    household: { firstNames: "Cooper and Susan", householdName: "the Cooper household" },
    scenarioLabel: "New Plan",
    documentRole: "standalone",
    hasProposal: true,
    strategies: [],
    goals: [],
    facts,
  };
}

const income = (n: number) => moneyFact("flow.income", "Money coming in this year", n, ["whereTheMoneyGoes"]);
const spending = (n: number) => moneyFact("flow.spending", "Money going out this year", n, ["whereTheMoneyGoes"]);
const saving = (n: number) => moneyFact("flow.saving", "What you're putting away", n, ["whereTheMoneyGoes"]);

const CTX = ctxWith([income(320_000), spending(210_000), saving(60_000)]);

const textOf = (ctx: StoryContext) => narrateWhereTheMoneyGoes(ctx).join(" ");

describe("narrateWhereTheMoneyGoes", () => {
  it("states all three figures", () => {
    const text = textOf(CTX);
    expect(text).toContain("$320K");
    expect(text).toContain("$210K");
    expect(text).toContain("$60K");
  });

  it("says the household is living within its income when it is", () => {
    expect(textOf(CTX)).toMatch(/more comes in than goes out/iu);
  });

  it("says so plainly when spending runs past income", () => {
    const tight = ctxWith([income(120_000), spending(190_000)]);
    expect(textOf(tight)).toMatch(/more goes out than comes in/iu);
  });

  it("counts saving as money going out, not as room to spare", () => {
    // Kills: comparing income against SPENDING alone. A household saving every
    // spare dollar has no headroom left, and telling them the gap "builds
    // everything else in this plan" is the opposite of true.
    const allSaved = ctxWith([income(200_000), spending(120_000), saving(100_000)]);
    expect(textOf(allSaved)).toMatch(/more goes out than comes in/iu);
    // …and the same household saving less does have room — a rule that said
    // "tight" either way would pass the assertion above and be worthless.
    const someSaved = ctxWith([income(200_000), spending(120_000), saving(40_000)]);
    expect(textOf(someSaved)).toMatch(/more comes in than goes out/iu);
  });

  it("never computes a figure of its own", () => {
    // The gap is $50K here and must NOT be printed — it is not in the pack, and
    // three rounded figures that do not visibly subtract to a fourth are worse
    // on a client page than no fourth at all.
    expect(textOf(CTX)).not.toContain("$50K");
  });

  it("states no direction from one side alone", () => {
    // Kills: defaulting the missing side to zero. "More comes in than goes out"
    // beside a pack that never held an outflow is a claim about nothing.
    const text = textOf(ctxWith([income(320_000)]));
    expect(text).not.toMatch(/more comes in than goes out|more goes out than comes in/iu);
  });

  it("handles income alone", () => {
    expect(textOf(ctxWith([income(320_000)]))).toContain("$320K");
  });

  it("handles spending alone", () => {
    expect(textOf(ctxWith([spending(210_000)]))).toContain("$210K");
  });

  it("says something true when the pack is empty", () => {
    const out = narrateWhereTheMoneyGoes(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object/u);
  });

  it("prints no figure that is not in the pack", () => {
    const shown = new Set(CTX.facts.map((f) => f.display));
    for (const figure of extractFigures(textOf(CTX))) {
      expect(shown.has(figure)).toBe(true);
    }
  });

  it("clears every gate on its own output", () => {
    expect(
      runGates(narrateWhereTheMoneyGoes(CTX).join("\n\n"), CTX.facts, {
        firstNames: ["Cooper", "Susan"],
      }),
    ).toEqual([]);
  });

  it("clears every gate on the tight branch and on the empty one", () => {
    for (const ctx of [ctxWith([income(120_000), spending(190_000)]), ctxWith([])]) {
      expect(
        runGates(narrateWhereTheMoneyGoes(ctx).join("\n\n"), ctx.facts, {
          firstNames: ["Cooper", "Susan"],
        }),
      ).toEqual([]);
    }
  });
});
