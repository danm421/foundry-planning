// The registry is the spine: the page count, the launcher summary, the render,
// the storage and the options control all read this one list. A chapter that is
// in the union but not in `CHAPTERS` — or in `CHAPTERS` under someone else's key
// — is a runtime hole none of those five would agree about.
import { describe, it, expect } from "vitest";
import { CHAPTERS, NARRATED_CHAPTERS, chapterEnumerates } from "../registry";
import { moneyFact } from "../../facts";
import { CHAPTER_IDS, type StoryContext } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Base Case",
  documentRole: "standalone",
  hasProposal: false,
  strategies: [],
  goals: [],
  facts: [],
};

describe("the chapter registry", () => {
  it("holds all fourteen chapters of the spec's arc", () => {
    expect(CHAPTER_IDS).toHaveLength(14);
  });

  it("is in document order — the arc, not alphabetical", () => {
    expect(CHAPTER_IDS).toEqual([
      "planInOnePage", // 0
      "whatWerePlanningFor", // 1
      "whatYouHave", // 2
      "whereTheMoneyGoes", // 3
      "thePathYoureOn", // 4
      "whatWeRecommend", // 5
      "willTheMoneyLast", // 6
      "whatYouCanSpend", // 7
      "whatsLeftForPeople", // 8
      "whatYoullPayInTax", // 9
      "protectingYourFamily", // 10
      "healthCareCosts", // 11
      "whatHappensNext", // 12
      "thingsToKnow", // 13
    ]);
  });

  it("registers every id exactly once, under its own key", () => {
    for (const id of CHAPTER_IDS) expect(CHAPTERS[id].id).toBe(id);
    expect(Object.keys(CHAPTERS)).toHaveLength(CHAPTER_IDS.length);
  });

  it("marks the five comparison chapters as needing a proposal", () => {
    const needing = CHAPTER_IDS.filter((id) => CHAPTERS[id].requiresProposal);
    expect(needing).toEqual([
      "whatWeRecommend",
      "willTheMoneyLast",
      "whatYouCanSpend",
      "whatsLeftForPeople",
      "whatYoullPayInTax",
    ]);
  });

  it("marks the four per-area chapters as coverage", () => {
    const coverage = CHAPTER_IDS.filter((id) => CHAPTERS[id].coverage);
    expect(coverage).toEqual([
      "whatsLeftForPeople",
      "whatYoullPayInTax",
      "protectingYourFamily",
      "healthCareCosts",
    ]);
  });

  /**
   * `available` answers "has this household anything for this chapter", and it
   * is a COVERAGE-chapter question only — a structural chapter carries the story
   * whatever the pack holds, so an absent predicate means "always".
   *
   * ⚠️ It is deliberately NOT a print filter. `printedChapters` reserves the
   * sheet from the options alone, so a chapter that hid on data the page count
   * could not see would mis-number every page after it. See `options-schema.ts`.
   */
  it("declares `available` only on coverage chapters, and answers on the pack", () => {
    for (const id of CHAPTER_IDS) {
      if (CHAPTERS[id].available) expect(CHAPTERS[id].coverage, id).toBe(true);
    }

    const estate = CHAPTERS.whatsLeftForPeople.available;
    expect(estate?.(CTX)).toBe(false);
    expect(estate?.({ ...CTX, facts: [moneyFact("estate.net.base", "What reaches your heirs, current plan", 3_100_000)] })).toBe(true);
    // …and it does not answer for its neighbour: a household with tax figures
    // and no estate must not be charged a model call for the estate chapter.
    expect(estate?.({ ...CTX, facts: [moneyFact("tax.lifetime.base", "Total income tax over the plan, current plan", 1_400_000)] })).toBe(false);

    const tax = CHAPTERS.whatYoullPayInTax.available;
    expect(tax?.(CTX)).toBe(false);
    expect(tax?.({ ...CTX, facts: [moneyFact("tax.lifetime.base", "Total income tax over the plan, current plan", 1_400_000)] })).toBe(true);

    const cover = CHAPTERS.protectingYourFamily.available;
    expect(cover?.(CTX)).toBe(false);
    expect(cover?.({ ...CTX, facts: [moneyFact("cover.have", "Cover in force on Cooper's life", 500_000)] })).toBe(true);
    // The two Task 17 chapters are the neighbours most easily confused: both are
    // about a risk rather than about the plan's own arithmetic, and both landed
    // in one task off one loader change.
    expect(cover?.({ ...CTX, facts: [moneyFact("medicare.lifetime", "What Medicare costs, current plan", 420_000)] })).toBe(false);

    const medicare = CHAPTERS.healthCareCosts.available;
    expect(medicare?.(CTX)).toBe(false);
    expect(medicare?.({ ...CTX, facts: [moneyFact("medicare.lifetime", "What Medicare costs, current plan", 420_000)] })).toBe(true);
    expect(medicare?.({ ...CTX, facts: [moneyFact("cover.have", "Cover in force on Cooper's life", 500_000)] })).toBe(false);
  });

  it("gives every chapter a client-facing title and a model brief", () => {
    for (const id of CHAPTER_IDS) {
      expect(CHAPTERS[id].title.length).toBeGreaterThan(0);
      expect(CHAPTERS[id].brief.length).toBeGreaterThan(0);
    }
  });

  it("uses only the four layouts the PDF knows how to print", () => {
    for (const id of CHAPTER_IDS) {
      expect(["heroProse", "twoUp", "strategyCards", "checklist"]).toContain(CHAPTERS[id].layout);
    }
  });

  it("throws with a message naming the gap, rather than narrating", () => {
    // The placeholder is the whole reason all fourteen slots can exist before
    // every narrator does. A silent empty array here would let a half-finished
    // chapter ship as a blank client page.
    //
    // Read off the list rather than naming one chapter: each Wave D task lands
    // a narrator, and a hard-coded name would have to be re-chosen every time.
    // The MESSAGE is what this case adds — the total check below proves which
    // chapters throw, not what they say. Task 19 empties the list, and then
    // there is no placeholder left to assert on.
    const pending = CHAPTER_IDS.find((id) => !NARRATED_CHAPTERS.includes(id));
    if (!pending) return;
    expect(() => CHAPTERS[pending].narrate(CTX)).toThrow(/no narrator yet/u);
  });

  it("narrates exactly the chapters NARRATED_CHAPTERS names, and no others", () => {
    // The list is what the options default and every enumerating suite read, so
    // it is proved against the registry rather than trusted: a narrator that
    // lands without joining the list, or a name in the list with no narrator
    // behind it, fails here.
    for (const id of CHAPTER_IDS) {
      let threw = false;
      try {
        CHAPTERS[id].narrate(CTX);
      } catch {
        threw = true;
      }
      expect(threw, id).toBe(!NARRATED_CHAPTERS.includes(id));
    }
  });
});

describe("chapterEnumerates", () => {
  it("is true for exactly the two layouts whose job is to name things", () => {
    // Cards name every strategy; the checklist names every next step. Both are
    // judged under the looser mean-sentence rule and without the triad rule, and
    // both are TOLD so by `prompts.ts` — one predicate, so the two cannot drift.
    const enumerating = CHAPTER_IDS.filter((id) => chapterEnumerates(id));
    expect(enumerating).toEqual(["whatWeRecommend", "whatHappensNext"]);
  });

  it("is false for a prose chapter", () => {
    expect(chapterEnumerates("planInOnePage")).toBe(false);
    expect(chapterEnumerates("willTheMoneyLast")).toBe(false);
  });
});
