import { describe, it, expect } from "vitest";
import { runGates } from "../index";
import type { GateFailure } from "../types";
import { moneyFact } from "../../facts";

const FACTS = [moneyFact("liquid", "Liquid assets", 2_100_000)]; // "$2.1M"

describe("runGates", () => {
  it("returns no failures for grounded, plain, varied prose", () => {
    const md =
      "You hold $2.1M today. That is enough to carry the plan through the years we modelled, and it leaves room to spare.";
    expect(runGates(md, FACTS)).toEqual([]);
  });

  it("collects failures from every gate at once", () => {
    const md = "It's important to note that your $9.9M in decumulation assets is fine.";
    const gates = runGates(md, FACTS).map((f) => f.gate);
    expect(gates).toContain("facts");
    expect(gates).toContain("readability");
    expect(gates).toContain("voice");
  });

  it("runs the chart-citation gate as part of the full set", () => {
    const chartFact = moneyFact("chart.portfolio.peak", "The most the plan ever holds", 2_100_000);
    const failures = runGates("The plan holds up well over time.", [chartFact]);
    expect(failures.some((f) => f.gate === "chartCitation")).toBe(true);
  });
});

describe("runGates — the two register gates", () => {
  const facts = [moneyFact("outcome.legacy.base", "Left at the end, current plan", 9_200_000)];

  it("reports a leaked label", () => {
    const out = runGates("Left at the end, current plan: $9.2M.", facts, { firstNames: ["Cooper"] });
    expect(out.some((f) => f.gate === "labels")).toBe(true);
  });

  it("reports self-reference", () => {
    const out = runGates("This page shows what you own.", facts, { firstNames: ["Cooper"] });
    expect(out.some((f) => f.gate === "register")).toBe(true);
  });

  it("reports a name used in the third person", () => {
    const out = runGates("For Cooper, that means more room.", facts, { firstNames: ["Cooper"] });
    expect(out.some((f) => f.gate === "register")).toBe(true);
  });

  // Deliberately UNEVEN in rhythm: three sentences of near-identical length are
  // a Gate 4 rejection on their own, and a "clean prose" fixture that trips
  // another gate proves nothing about these two.
  it("passes clean second-person prose", () => {
    const out = runGates(
      "You end up with about $9.2M. That is more room than you started with, and it holds even if the market has a poor decade early on. Nothing needs fixing today.",
      facts,
      { firstNames: ["Cooper"] },
    );
    expect(out).toEqual([]);
  });

  // Gate 7 is only useful if it is in the ARRAY. Every other test of it calls
  // the gate directly, so deleting `foreignNamesGate(...)` from `runGates` left
  // the whole suite green.
  it("reports a name from another household", () => {
    const out = runGates("Cooper asked whether it holds.", facts, { firstNames: ["Alan"] });
    expect(out.some((f) => f.gate === "foreignName")).toBe(true);
  });

  it("does not report a name the household's own goals supplied", () => {
    const out = runGates("Cooper asked whether it holds.", facts, {
      firstNames: ["Alan"],
      householdText: ["A wedding for Cooper"],
    });
    expect(out.some((f) => f.gate === "foreignName")).toBe(false);
  });

  it("still runs the four original gates", () => {
    const out = runGates("You have $3.4M saved.", facts, { firstNames: ["Cooper"] });
    expect(out.some((f) => f.gate === "facts")).toBe(true);
  });
});

describe("runGates — the enumerating chapter", () => {
  const facts = [moneyFact("today.liquid", "Liquid assets", 2_100_000)];

  /**
   * Exactly `n` whitespace-separated words, closed with a full stop. Both
   * length rules count tokens and never read them, so the content is
   * irrelevant and the COUNT has to be exact — a hand-written fixture that
   * drifts by a word pins a different number than the one it names.
   */
  const sentenceOf = (n: number): string => ["You", ...Array<string>(n - 1).fill("hold")].join(" ") + ".";
  const only = (gate: GateFailure["gate"]) => (out: GateFailure[]) => out.filter((f) => f.gate === gate);
  const readability = only("readability");
  const voice = only("voice");

  /** The four real first drafts measured 21, 21, 24 and 26 words a sentence. */
  const MEAN_24 = [sentenceOf(24), sentenceOf(24), sentenceOf(24)].join(" ");
  const MEAN_26 = [sentenceOf(26), sentenceOf(26), sentenceOf(26)].join(" ");

  /** What a household's assets look like written out. The triad matcher sees
   *  three comma-separated items closed by "and" and cannot tell it from a
   *  rhetorical flourish. */
  const ASSET_LIST = "Your savings sit in the Exchange Traded Fund, your residence, and autos.";
  const RHETORICAL_TRIAD = "The plan is clearer, simpler, and more effective.";

  it("accepts a 24-word mean that a normal chapter rejects", () => {
    expect(readability(runGates(MEAN_24, facts, { enumerates: true }))).toEqual([]);
    expect(readability(runGates(MEAN_24, facts))).not.toEqual([]);
  });

  it("is a looser cap, not an off switch — a 26-word mean still fails", () => {
    expect(readability(runGates(MEAN_26, facts, { enumerates: true }))).not.toEqual([]);
  });

  it("still rejects a single 41-word sentence", () => {
    // Mean 6.8, so the only rule that can fire here is the per-sentence cap —
    // which is what makes this a test of that cap rather than of the mean.
    const runaway = [sentenceOf(41), ...Array<string>(9).fill(sentenceOf(3))].join(" ");
    const failures = readability(runGates(runaway, facts, { enumerates: true }));
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("41 words");
  });

  it("accepts a list of what the household owns, which a normal chapter rejects", () => {
    expect(voice(runGates(ASSET_LIST, facts, { enumerates: true }))).toEqual([]);
    expect(voice(runGates(ASSET_LIST, facts))).not.toEqual([]);
  });

  // The honest half of the trade. Turning the triad rule off to let an asset
  // list through also lets the flourish through, and a test that says so is the
  // record of what was given up — not a defect to be quietly discovered later.
  it("also accepts a real rhetorical triad — the cost of the rule above", () => {
    expect(voice(runGates(RHETORICAL_TRIAD, facts, { enumerates: true }))).toEqual([]);
    expect(voice(runGates(RHETORICAL_TRIAD, facts))).not.toEqual([]);
  });

  it("leaves every other gate alone", () => {
    const out = runGates("You have $3.4M saved.", facts, { enumerates: true, firstNames: ["Cooper"] });
    expect(out.some((f) => f.gate === "facts")).toBe(true);
    expect(runGates("This page shows what you own.", facts, { enumerates: true }).some((f) => f.gate === "register")).toBe(true);
  });
});
