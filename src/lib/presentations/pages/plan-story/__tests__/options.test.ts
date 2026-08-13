import { describe, it, expect } from "vitest";
import {
  planStoryOptionsSchema,
  PLAN_STORY_OPTIONS_DEFAULT,
  PRESETS,
  applyPreset,
  printedChapters,
  planStoryProposedRef,
  planStoryHasProposal,
  type PlanStoryOptions,
} from "../options-schema";
import { estimatePlanStoryPageCount } from "../estimate-page-count";
import { summarizePlanStoryOptions } from "../summarize-options";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS, type ChapterId } from "@/lib/presentations/story/types";

/** The same options with a live scenario picked — the only thing that makes the
 *  recommendation chapter printable. */
const WITH_PROPOSAL: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };

function withSections(over: Partial<PlanStoryOptions["sections"]>): PlanStoryOptions {
  return {
    ...PLAN_STORY_OPTIONS_DEFAULT,
    sections: { ...PLAN_STORY_OPTIONS_DEFAULT.sections, ...over },
  };
}

/** The chapters that have a narrator. The remaining slots exist so the page
 *  count, the render and storage agree from the start — and are off in the
 *  shipped default until their task lands.
 *
 *  Spelled out rather than read from `NARRATED_CHAPTERS`: the default is BUILT
 *  from that list, so a test that also read it could not fail. Wave D updates
 *  this line as each narrator lands, which is the point — the shipped default
 *  changing is a decision, not a side effect. */
const LANDED: ChapterId[] = [
  "planInOnePage",
  "whatWerePlanningFor",
  "whatYouHave",
  "whereTheMoneyGoes",
  "thePathYoureOn",
  "whatWeRecommend",
  "willTheMoneyLast",
  "whatYouCanSpend",
];

/** What the shipped default actually PRINTS: every landed chapter, less the ones
 *  with nothing to recommend on a base-only story.
 *
 *  Derived rather than spelled out a second time. Each Wave D task adds one line
 *  to `LANDED` above, and every count and list below follows — the alternative
 *  was nine literal expectations that all restate the same fact and all have to
 *  be edited together, which is how one of them ends up saying something else. */
const LANDED_BASE_ONLY = LANDED.filter((id) => !CHAPTERS[id].requiresProposal);

/** What every stored deck and every freshly added page starts as. */
function defaultSections(over: Partial<Record<string, boolean>> = {}): Record<string, boolean> {
  return Object.fromEntries(CHAPTER_IDS.map((id) => [id, over[id] ?? LANDED.includes(id)]));
}

/** Every chapter switched on, with a plan to recommend.
 *
 *  The `printedChapters` rules below are about the REGISTRY — which chapters need
 *  a proposal, which self-hide when empty — so they need an options object with
 *  all fourteen on. The `full` preset used to be that object and is not one
 *  while it carries the `NARRATED_CHAPTERS` clause, so it is built here instead.
 *  Deliberately NOT switched back to the preset when Task 19 restores it: a rule
 *  about the registry should not be read through a preset that can change. */
const ALL_ON: PlanStoryOptions = {
  ...PLAN_STORY_OPTIONS_DEFAULT,
  scenarioId: "scn-1",
  sections: Object.fromEntries(
    CHAPTER_IDS.map((id) => [id, true]),
  ) as PlanStoryOptions["sections"],
};

describe("planStoryOptionsSchema", () => {
  it("defaults to the full story, standalone, with no scenario picked", () => {
    const parsed = planStoryOptionsSchema.parse({});
    expect(parsed.preset).toBe("full");
    expect(parsed.documentRole).toBe("standalone");
    expect(parsed.scenarioId).toBe("");
    expect(parsed.sections).toEqual(defaultSections());
  });

  it("switches the chapters that have no narrator off by default", () => {
    // The point of the default: a page added to a deck today renders exactly the
    // report the app renders today, never a placeholder sheet.
    const parsed = planStoryOptionsSchema.parse({});
    const on = CHAPTER_IDS.filter((id) => parsed.sections[id]);
    expect(on).toEqual(LANDED);
  });

  it("accepts the shipped default object unchanged", () => {
    expect(planStoryOptionsSchema.parse(PLAN_STORY_OPTIONS_DEFAULT)).toEqual(
      PLAN_STORY_OPTIONS_DEFAULT,
    );
  });

  it("fills the sections a stored deck never wrote", () => {
    // Zod 4: a field declared `.default(x)` alone still defaults inside a
    // partially-supplied object. `.optional().default(x)` would leave these
    // undefined and `printedChapters` would silently drop every chapter.
    const parsed = planStoryOptionsSchema.parse({ sections: { planInOnePage: false } });
    expect(parsed.sections).toEqual(defaultSections({ planInOnePage: false }));
  });

  it("fills every one of the fourteen keys a deck stored before Plan 2 lacks", () => {
    // A deck saved when the union held three chapters parses with eleven keys
    // missing. Any that came back undefined would read as "off" — harmless — but
    // would also mean the per-key defaults had stopped applying, which is the
    // Zod-4 trap this file exists to pin.
    const parsed = planStoryOptionsSchema.parse({
      sections: { planInOnePage: true, whatYouHave: true, whatWeRecommend: true },
    });
    for (const id of CHAPTER_IDS) expect(typeof parsed.sections[id]).toBe("boolean");
  });
});

describe("applyPreset", () => {
  it("brief enables only the punchline and the recommendation, and points forward", () => {
    const o = applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief");
    expect(o.preset).toBe("brief");
    expect(o.sections.planInOnePage).toBe(true);
    expect(o.sections.whatWeRecommend).toBe(true);
    expect(o.sections.whatYouHave).toBe(false);
    expect(o.documentRole).toBe("frontMatter");
  });

  it("full enables every landed chapter and stands alone", () => {
    // TASK 19 restores this to `every(Boolean)` — all fourteen — in the same
    // commit that drops the `NARRATED_CHAPTERS` clause from both presets.
    const o = applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "full");
    expect(o.preset).toBe("full");
    expect(CHAPTER_IDS.filter((id) => o.sections[id])).toEqual(LANDED);
    expect(o.documentRole).toBe("standalone");
  });

  it("keeps the picked scenario — a preset changes chapters, not the plan", () => {
    // Load-bearing: the preset carries `sections` and `documentRole` only. If it
    // ever replaced the whole object it would blank `scenarioId`, and the
    // recommendation chapter would vanish the moment an advisor switched preset.
    expect(applyPreset(WITH_PROPOSAL, "brief").scenarioId).toBe("scn-1");
    expect(applyPreset(WITH_PROPOSAL, "full").scenarioId).toBe("scn-1");
  });

  it("PRESETS carries no scenario field for applyPreset to overwrite", () => {
    for (const preset of Object.values(PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual(["documentRole", "sections"]);
    }
  });
});

describe("planStoryProposedRef", () => {
  it("treats no scenario and the base scenario alike — neither is a proposal", () => {
    expect(planStoryProposedRef("")).toBeNull();
    expect(planStoryProposedRef("base")).toBeNull();
  });

  it("returns a live scenario id unchanged, so the export loader can pass it through", () => {
    expect(planStoryProposedRef("scn-1")).toBe("scn-1");
  });

  it("reports the proposal through the options wrapper", () => {
    expect(planStoryHasProposal(PLAN_STORY_OPTIONS_DEFAULT)).toBe(false);
    expect(planStoryHasProposal({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "base" })).toBe(false);
    expect(planStoryHasProposal(WITH_PROPOSAL)).toBe(true);
  });
});

describe("printedChapters", () => {
  it("drops the recommendation on a base-only story, even though it is switched on", () => {
    expect(PLAN_STORY_OPTIONS_DEFAULT.sections.whatWeRecommend).toBe(true);
    expect(printedChapters(PLAN_STORY_OPTIONS_DEFAULT)).toEqual(LANDED_BASE_ONLY);
  });

  it("returns every chapter in document order once a scenario is picked", () => {
    expect(printedChapters(WITH_PROPOSAL)).toEqual(LANDED);
  });

  it("treats an explicit 'base' exactly as no scenario at all", () => {
    expect(printedChapters({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "base" })).toEqual(
      LANDED_BASE_ONLY,
    );
  });

  it("drops a chapter that is switched off", () => {
    expect(printedChapters({ ...WITH_PROPOSAL, sections: { ...WITH_PROPOSAL.sections, whatYouHave: false } })).toEqual(
      LANDED.filter((id) => id !== "whatYouHave"),
    );
  });

  it("hides exactly the chapters the registry marks as needing a proposal", () => {
    // Driven off CHAPTERS rather than a hard-coded list, so a fifteenth chapter
    // cannot be added without this rule being applied to it. Read on ALL_ON —
    // the rule is the registry's, and the full preset is only all-on again once
    // Task 19 lands.
    const proposed = printedChapters(ALL_ON);
    const baseOnly = printedChapters({ ...ALL_ON, scenarioId: "" });
    for (const id of CHAPTER_IDS) {
      expect(proposed).toContain(id);
      expect(baseOnly.includes(id)).toBe(!CHAPTERS[id].requiresProposal);
    }
  });

  it("keeps a coverage chapter's sheet even when it has nothing in it", () => {
    // THE PAGE-COUNT CONTRACT, guarded structurally.
    //
    // `estimatePlanStoryPageCount` reserves sheets from the OPTIONS alone —
    // `document.tsx` calls it with no data — and `documentSections` numbers the
    // table of contents from that reservation. A chapter that hid at render time
    // on data the count never saw would mis-number every page after it and
    // overstate the total on all of them: the defect Plan 1 fixed twice.
    //
    // So `available` is NOT read here, and a chapter with nothing to say prints
    // an honest empty state on its reserved sheet instead. Proved on a real
    // registry entry, patched and put back, rather than on a fabricated def that
    // could not drift with the code.
    const def = CHAPTERS.protectingYourFamily;
    const original = def.available;
    try {
      def.available = () => false;
      expect(printedChapters(ALL_ON)).toContain("protectingYourFamily");
    } finally {
      def.available = original;
    }
  });

  it("takes no context, so the count and the render cannot be handed different data", () => {
    // The rule above, stated as a type-level fact rather than a behaviour: the
    // signature is what makes a third filter impossible to add by accident.
    expect(printedChapters).toHaveLength(1);
  });
});

describe("estimatePlanStoryPageCount", () => {
  // document.tsx calls this with NO data — it must work from options alone.
  it("counts one page per chapter that will actually print", () => {
    // One fewer than the default has switched on: the default picks no
    // scenario, so the recommendation chapter cannot render and must not be
    // numbered.
    expect(estimatePlanStoryPageCount(undefined as never, PLAN_STORY_OPTIONS_DEFAULT)).toBe(
      LANDED_BASE_ONLY.length,
    );
    expect(estimatePlanStoryPageCount(undefined as never, WITH_PROPOSAL)).toBe(LANDED.length);
  });

  it("counts the brief preset against the story it is actually telling", () => {
    // One page with no plan to compare — two of the brief's three chapters need
    // a proposal — and all three once one is picked.
    const brief = applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief");
    expect(estimatePlanStoryPageCount(undefined as never, brief)).toBe(1);
    expect(estimatePlanStoryPageCount(undefined as never, applyPreset(WITH_PROPOSAL, "brief"))).toBe(3);
  });

  it("never reports zero, so an all-off report still occupies a page", () => {
    const none = withSections(
      Object.fromEntries(CHAPTER_IDS.map((id) => [id, false])) as PlanStoryOptions["sections"],
    );
    expect(estimatePlanStoryPageCount(undefined as never, none)).toBe(1);
  });

  it("ignores whatever is handed to it as data", () => {
    const junk = { chapters: [1, 2, 3, 4, 5] } as never;
    expect(estimatePlanStoryPageCount(junk, PLAN_STORY_OPTIONS_DEFAULT)).toBe(
      LANDED_BASE_ONLY.length,
    );
  });
});

describe("summarizePlanStoryOptions", () => {
  it("names the preset and the number of chapters that will print", () => {
    expect(summarizePlanStoryOptions(PLAN_STORY_OPTIONS_DEFAULT)).toBe(
      `Full story · ${LANDED_BASE_ONLY.length} chapters`,
    );
    expect(summarizePlanStoryOptions(WITH_PROPOSAL)).toBe(`Full story · ${LANDED.length} chapters`);
  });

  it("says one chapter in the singular", () => {
    expect(summarizePlanStoryOptions(applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief"))).toBe(
      "Executive brief · 1 chapter",
    );
  });

  it("names a hand-tuned report Custom", () => {
    const custom: PlanStoryOptions = {
      // Everything the default switches on, off again, save the punchline.
      ...withSections(
        Object.fromEntries(LANDED.filter((id) => id !== "planInOnePage").map((id) => [id, false])),
      ),
      scenarioId: "scn-1",
      preset: "custom",
    };
    expect(summarizePlanStoryOptions(custom)).toBe("Custom · 1 chapter");
  });

  it("counts the full preset's landed chapters", () => {
    // TASK 19 makes this 14, when both presets drop the `NARRATED_CHAPTERS`
    // clause. Until then the launcher row must not promise sheets that would
    // print "We'll cover this together." and nothing else.
    expect(summarizePlanStoryOptions(applyPreset(WITH_PROPOSAL, "full"))).toBe(
      `Full story · ${LANDED.length} chapters`,
    );
  });

  it("agrees with the page count the launcher row shows beside it", () => {
    for (const options of [PLAN_STORY_OPTIONS_DEFAULT, WITH_PROPOSAL, applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief")]) {
      const stated = Number(/·\s(\d+)\schapter/u.exec(summarizePlanStoryOptions(options))![1]);
      expect(stated).toBe(estimatePlanStoryPageCount(undefined as never, options));
    }
  });
});

describe("the two presets", () => {
  // Both presets are trimmed to the chapters that HAVE a narrator, by the same
  // rule the shipped default uses. A preset is one click, and an untrimmed
  // `full` would print eleven sheets reading only "We'll cover this together."
  //
  // TASK 19 restores both to the spec's shape by deleting the
  // `NARRATED_CHAPTERS` clause from each, in the same commit that flips the
  // per-key defaults on. Every expectation in this block moves with it.
  it("Full story turns on every landed chapter", () => {
    const o = applyPreset(WITH_PROPOSAL, "full");
    expect(printedChapters(o)).toEqual(LANDED); // Task 19: all fourteen.
  });

  it("Executive brief is exactly the spec's 0, 5 and 6", () => {
    // Whole again as of Task 15: `willTheMoneyLast` has a narrator, so the
    // `NARRATED_CHAPTERS` clause no longer trims anything off this preset. The
    // clause stays until Task 19 all the same — it is what stops a FUTURE
    // chapter joining `BRIEF_CHAPTERS` before it can say anything.
    const o = applyPreset(WITH_PROPOSAL, "brief");
    expect(printedChapters(o)).toEqual(["planInOnePage", "whatWeRecommend", "willTheMoneyLast"]);
  });

  it("Executive brief writes in the front-matter register", () => {
    expect(applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief").documentRole).toBe("frontMatter");
  });

  it("drops the comparison chapters from either preset on a base-only story", () => {
    // The five-chapter version of this rule is pinned against the registry in
    // `printedChapters` above, on ALL_ON. Here it is read on the presets, which
    // is where an advisor meets it: one of the full preset's landed three needs
    // a proposal, and so does one of the brief's two.
    const full = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "" }, "full");
    expect(printedChapters(full)).toEqual(LANDED_BASE_ONLY);
    const brief = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "" }, "brief");
    expect(printedChapters(brief)).toEqual(["planInOnePage"]);
  });

  it("keeps the estimate and the print list the same call", () => {
    const o = applyPreset(WITH_PROPOSAL, "full");
    expect(estimatePlanStoryPageCount(undefined as never, o)).toBe(printedChapters(o).length);
  });

  it("carries every chapter of the arc as a key, in both presets", () => {
    // A preset built by hand is where a fifteenth chapter goes missing. Both are
    // built from CHAPTER_IDS, so neither can.
    for (const preset of Object.values(PRESETS)) {
      expect(Object.keys(preset.sections).sort()).toEqual([...CHAPTER_IDS].sort());
    }
  });
});
