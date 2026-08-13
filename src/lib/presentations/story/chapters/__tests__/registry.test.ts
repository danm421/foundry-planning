// The registry is the spine: the page count, the launcher summary, the render,
// the storage and the options control all read this one list. A chapter that is
// in the union but not in `CHAPTERS` — or in `CHAPTERS` under someone else's key
// — is a runtime hole none of those five would agree about.
import { describe, it, expect } from "vitest";
import { CHAPTERS, NARRATED_CHAPTERS, chapterEnumerates } from "../registry";
import { CHAPTER_IDS, type StoryContext } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Base Case",
  documentRole: "standalone",
  hasProposal: false,
  strategies: [],
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

  it("throws rather than narrating a chapter whose task has not landed", () => {
    // The placeholder is the whole reason all fourteen slots can exist before
    // eleven of the narrators do. A silent empty array here would let a
    // half-finished chapter ship as a blank client page.
    expect(() => CHAPTERS.whereTheMoneyGoes.narrate(CTX)).toThrow(/no narrator yet/u);
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
