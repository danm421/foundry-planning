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

  // The dictionary reaches past the Anglo lists, and an accented spelling has to
  // survive both the capitalised-word match and the lowercasing to be found.
  it.each(["Priya asked the same thing.", "It went that way for Sofía too."])(
    "rejects a name from outside the Anglo lists: %s",
    (prose) => {
      expect(GATE(prose, [])).toHaveLength(1);
    },
  );

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
    // The three the first version of this dictionary got WRONG. `john` and `sam`
    // shipped in it, and both of these are ordinary prose for a chapter this app
    // already writes — the tax chapter and the insurance chapter.
    "Uncle Sam takes his cut before you see a dollar of it.",
    "The John Hancock policy pays out first, and the Lincoln annuity follows.",
    "We size the bet with the Kelly criterion, not with the Taylor rule.",
    // …and the same class, caught by reading the list rather than by a report:
    "Robbing Peter to pay Paul is not a plan, and Adam Smith knew it.",
    "Lloyd's will not write it, and the Gordon growth model says why.",
  ])("does not read an ordinary capitalised word as a person: %s", (prose) => {
    expect(GATE(prose, [])).toHaveLength(0);
  });

  it("reports every foreign name once, in a single failure", () => {
    const out = GATE("Cooper and Susan both asked. Cooper asked twice.", []);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("Cooper");
    expect(out[0].message).toContain("Susan");
  });

  // The message is reused verbatim in the retry prompt, so the model reads it.
  // "You named Cooper, Susan, who is not part…" is not a sentence.
  it("reads as a sentence for one name and for several", () => {
    expect(GATE("Cooper asked.", [])[0].message).toContain(
      "You named Cooper, who is not part of this household.",
    );
    expect(GATE("Cooper and Susan asked, and so did Dana.", [])[0].message).toContain(
      "You named Cooper, Susan and Dana, who are not part of this household.",
    );
  });
});

/**
 * A name the household's own record supplied.
 *
 * `StoryHousehold` is the two adults and nothing else, but a goal name is typed
 * by the client and `types.ts` calls it "the one thing on chapter 1 that must
 * reach the client unaltered". Without this, a goal called "College for Emma"
 * makes chapter 1 reject itself and the retry instructs the model to remove the
 * client's daughter from their own plan.
 */
describe("Gate 7 — names the household itself supplied", () => {
  const GOALS = ["College for Emma", "Help Jake with a house"];

  it("accepts a person named in the household's own goal", () => {
    const gate = foreignNamesGate(["Alan", "Teresa"], GOALS);
    expect(gate("Emma starts college in that year, and you can cover it.", [])).toHaveLength(0);
  });

  it("still rejects a genuinely foreign name in the same draft", () => {
    const gate = foreignNamesGate(["Alan", "Teresa"], GOALS);
    const out = gate("Emma starts college then, the way it went for Susan.", []);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("Susan");
    expect(out[0].message).not.toContain("Emma");
  });

  // A WORD, not a substring — the same rule the dictionary lookup keeps. A goal
  // called "Susannah's wedding" must not quietly license "Susan".
  it("matches the supplied text as words, not as substrings", () => {
    const gate = foreignNamesGate(["Alan"], ["Susannah's wedding"]);
    expect(gate("It worked the way it did for Susan.", [])).toHaveLength(1);
  });

  it("is optional — the one-argument call the rest of the gate uses still works", () => {
    expect(foreignNamesGate(["Alan"])("Cooper asked.", [])).toHaveLength(1);
  });
});
