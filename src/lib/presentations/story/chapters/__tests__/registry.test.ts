// The registry is the spine: the page count, the launcher summary, the render,
// the storage and the options control all read this one list. A chapter that is
// in the union but not in `CHAPTERS` — or in `CHAPTERS` under someone else's key
// — is a runtime hole none of those five would agree about.
import { describe, it, expect } from "vitest";
import { CHAPTERS, chapterEnumerates } from "../registry";
import { moneyFact } from "../../facts";
import { CHAPTER_IDS, type ChapterId, type StoryContext } from "../../types";

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

  // Hand-written on purpose, and it is the RENDERER's list: `chapter-pdf.tsx`
  // gives four of these a branch of their own — `chartWithProse`, `twoUp`,
  // `glossary` and `checklist` — and serves the remaining two from one
  // fall-through, which prints the prose plus the strategy cards for whichever
  // of the two carries any. A SEVENTH layout added here would land on that
  // fall-through and print as a bare prose sheet, with its own collection,
  // whatever it is, silently absent from a client's page.
  it("uses only the six layouts the PDF knows how to print", () => {
    for (const id of CHAPTER_IDS) {
      expect([
        "heroProse",
        "twoUp",
        "strategyCards",
        "checklist",
        "glossary",
        "chartWithProse",
      ]).toContain(CHAPTERS[id].layout);
    }
  });

  it("prints the three chart chapters on the chartWithProse layout", () => {
    expect(CHAPTERS.willTheMoneyLast.layout).toBe("chartWithProse");
    expect(CHAPTERS.whatYoullPayInTax.layout).toBe("chartWithProse");
    expect(CHAPTERS.whatsLeftForPeople.layout).toBe("chartWithProse");
  });

  it("does not count the estate chapter as enumerating", () => {
    // `chartWithProse` is deliberately absent from `ENUMERATING_LAYOUTS`, which
    // the compiler cannot enforce — the layout union is closed but that list is
    // hand-written, so a sixth layout added to it silently changes what this
    // chapter is asked for.
    expect(chapterEnumerates("whatsLeftForPeople")).toBe(false);
  });

  /**
   * The successor to the placeholder rule this file used to carry.
   *
   * While the arc landed a chapter at a time, an unwritten slot's `narrate`
   * THREW in test and the suite asserted which ones did — that is what stopped
   * a half-finished chapter shipping as a blank client page. Every slot has a
   * narrator now, so the same contract is stated positively: all fourteen say
   * something, on a context with nothing in it. A fifteenth chapter added
   * without a narrator fails here rather than printing an empty sheet.
   */
  it("gives every chapter a narrator that says something on an empty pack", () => {
    for (const id of CHAPTER_IDS) {
      const out = CHAPTERS[id].narrate(CTX);
      expect(out.length, id).toBeGreaterThan(0);
      expect(out.join(" ").trim().length, id).toBeGreaterThan(0);
      expect(out.join(" "), id).not.toMatch(/undefined|null|\[object/u);
    }
  });

  /**
   * …and that no two of them say the SAME thing.
   *
   * ⚠️ What this does and does not cover, measured rather than assumed. It
   * catches a placeholder used TWICE and a chapter wired to its neighbour's
   * narrator — both proved by mutation. It does NOT catch a single bespoke
   * stub: `() => ["We'll cover this together."]` on one chapter is distinct
   * from the other thirteen and survives this case. That one is caught by the
   * chapter's OWN suite, which is where the real guarantee lives — and a
   * fifteenth chapter landing with a stub AND no suite of its own is caught by
   * nothing here. Worth knowing before trusting this line.
   *
   * It is worth keeping on its own terms all the same: two chapters printing
   * the same paragraph is a live defect class in this report — the 2026-08-12
   * read found the balance-sheet chapter re-narrating the headline's figures on
   * the very next sheet, which is what the per-chapter fact scoping now stops.
   *
   * Checked on the EMPTY pack, which is the hardest case: it is where every
   * narrator is closest to boilerplate, so two that differ only once there are
   * figures to print would still fail here.
   */
  it("gives every chapter a narrative no other chapter also writes", () => {
    const byText = new Map<string, ChapterId>();
    for (const id of CHAPTER_IDS) {
      const text = CHAPTERS[id].narrate(CTX).join(" ");
      expect(byText.get(text) ?? id, `${id} narrates exactly like ${byText.get(text)}`).toBe(id);
      byText.set(text, id);
    }
    expect(byText.size).toBe(CHAPTER_IDS.length);
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
