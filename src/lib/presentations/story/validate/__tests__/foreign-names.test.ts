import { describe, it, expect } from "vitest";
import { foreignNamesGate } from "../foreign-names";

const GATE = foreignNamesGate(["Alan", "Teresa"]);

describe("Gate 7 — a name from another household", () => {
  // The RED, first and deliberately: this is the failure the gate exists for.
  it("rejects a draft naming somebody who is not in this household", () => {
    const out = GATE("Cooper, your plan holds up well.", []);
    expect(out).toHaveLength(1);
    expect(out[0].gate).toBe("foreignName");
  });

  it("rejects a name in the middle of a sentence too", () => {
    expect(GATE("The change works the way it did for Susan.", [])).toHaveLength(1);
  });

  // …and the must-PASS half, which is the larger risk. This gate reads capitalised
  // words, and a report is full of them.
  it("accepts this household's own names", () => {
    expect(GATE("Alan, your plan holds up well. Teresa's side is fine too.", [])).toHaveLength(0);
  });

  it.each([
    "Your Social Security starts in that year.",
    "The Roth conversion is the change that moves it.",
    "Medicare picks up most of it.",
    "We'll walk through the rest together in March.",
    "You own a Traditional IRA and a Roth IRA.",
  ])("accepts ordinary report prose: %s", (prose) => {
    expect(GATE(prose, [])).toHaveLength(0);
  });

  it("accepts a sentence opening with an ordinary capitalised word", () => {
    expect(GATE("Here's the short version. Your plan holds.", [])).toHaveLength(0);
  });

  /**
   * The exclusion rule in `given-names.ts`, pinned.
   *
   * This gate has no sentence-position exemption — a chapter opening "Cooper,
   * your plan holds" is the canonical leak AND the canonical opening, so a gate
   * blind to a sentence-initial name is blind to the failure it was built for.
   * The whole false-positive defence therefore lives in the DICTIONARY, and
   * these are the cases that would break if it stopped being curated: an
   * ordinary word, a month, or report vocabulary that happens to be somebody's
   * name, sitting where a report capitalises it.
   */
  it.each([
    "Will the money last? Mark the date.",
    "Bill pay is set up, and the Penny you save is a Penny earned.",
    "Grace and Hope are not the plan; Faith in the market is not either.",
    "August and June are the two months that matter.",
    "Rich in assets, Frank about the risk — that is where you are.",
    "Summer spending runs high, and Dawn to dusk you think about it.",
  ])("does not read an ordinary capitalised word as a person: %s", (prose) => {
    expect(GATE(prose, [])).toHaveLength(0);
  });

  it("reports every foreign name once, in a single failure", () => {
    const out = GATE("Cooper and Susan both asked. Cooper asked twice.", []);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("Cooper");
    expect(out[0].message).toContain("Susan");
  });
});
