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
import { CHAPTER_IDS, type StoryContext } from "@/lib/presentations/story/types";

/** Enough of a story for the availability rule to be handed something real. */
const CTX: StoryContext = {
  household: { firstNames: "Cooper and Susan", householdName: "the Cooper household" },
  scenarioLabel: "New Plan",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [],
  facts: [],
};

/** The same options with a live scenario picked — the only thing that makes the
 *  recommendation chapter printable. */
const WITH_PROPOSAL: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };

function withSections(over: Partial<PlanStoryOptions["sections"]>): PlanStoryOptions {
  return {
    ...PLAN_STORY_OPTIONS_DEFAULT,
    sections: { ...PLAN_STORY_OPTIONS_DEFAULT.sections, ...over },
  };
}

/** The chapters that have a narrator. The other eleven slots exist so the page
 *  count, the render and storage agree from the start — and are off in the
 *  shipped default until their task lands.
 *
 *  Spelled out rather than read from `NARRATED_CHAPTERS`: the default is BUILT
 *  from that list, so a test that also read it could not fail. Wave D updates
 *  this line as each narrator lands, which is the point — the shipped default
 *  changing is a decision, not a side effect. */
const LANDED = ["planInOnePage", "whatYouHave", "whatWeRecommend"];

/** What every stored deck and every freshly added page starts as. */
function defaultSections(over: Partial<Record<string, boolean>> = {}): Record<string, boolean> {
  return Object.fromEntries(CHAPTER_IDS.map((id) => [id, over[id] ?? LANDED.includes(id)]));
}

describe("planStoryOptionsSchema", () => {
  it("defaults to the full story, standalone, with no scenario picked", () => {
    const parsed = planStoryOptionsSchema.parse({});
    expect(parsed.preset).toBe("full");
    expect(parsed.documentRole).toBe("standalone");
    expect(parsed.scenarioId).toBe("");
    expect(parsed.sections).toEqual(defaultSections());
  });

  it("switches the eleven chapters that have no narrator off by default", () => {
    // The point of the default: a page added to a deck today renders exactly the
    // three-chapter report the app renders today, not eleven placeholder sheets.
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

  it("full enables everything and stands alone", () => {
    const o = applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "full");
    expect(o.preset).toBe("full");
    expect(Object.values(o.sections).every(Boolean)).toBe(true);
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
    expect(printedChapters(PLAN_STORY_OPTIONS_DEFAULT)).toEqual([
      "planInOnePage",
      "whatYouHave",
    ]);
  });

  it("returns every chapter in document order once a scenario is picked", () => {
    expect(printedChapters(WITH_PROPOSAL)).toEqual([
      "planInOnePage",
      "whatYouHave",
      "whatWeRecommend",
    ]);
  });

  it("treats an explicit 'base' exactly as no scenario at all", () => {
    expect(printedChapters({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "base" })).toEqual([
      "planInOnePage",
      "whatYouHave",
    ]);
  });

  it("drops a chapter that is switched off", () => {
    expect(printedChapters({ ...WITH_PROPOSAL, sections: { ...WITH_PROPOSAL.sections, whatYouHave: false } })).toEqual([
      "planInOnePage",
      "whatWeRecommend",
    ]);
  });

  it("hides exactly the chapters the registry marks as needing a proposal", () => {
    // Driven off CHAPTERS rather than a hard-coded list, so a fifteenth chapter
    // cannot be added without this rule being applied to it. Read on the full
    // preset, which is the only options object with every chapter switched on.
    const full = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" }, "full");
    const proposed = printedChapters(full);
    const baseOnly = printedChapters({ ...full, scenarioId: "" });
    for (const id of CHAPTER_IDS) {
      expect(proposed).toContain(id);
      expect(baseOnly.includes(id)).toBe(!CHAPTERS[id].requiresProposal);
    }
  });

  it("hides a coverage chapter with nothing in it for this household", () => {
    // The third rule. No chapter defines `available` yet — Wave D's coverage
    // chapters do — so it is proved on a real registry entry, patched and put
    // back, rather than on a fabricated def that could not drift with the code.
    const full = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" }, "full");
    const def = CHAPTERS.protectingYourFamily;
    const original = def.available;
    try {
      def.available = () => false;
      expect(printedChapters(full, CTX)).not.toContain("protectingYourFamily");
      // …and the same chapter, available, still prints — a rule that hid it
      // either way would pass the assertion above and be worthless.
      def.available = () => true;
      expect(printedChapters(full, CTX)).toContain("protectingYourFamily");
    } finally {
      def.available = original;
    }
  });

  it("skips the availability rule when it is handed no context at all", () => {
    // `document.tsx` calls the estimate with no data. The count and the render
    // therefore agree by construction, and the cost is that `available` may only
    // depend on what the options already imply.
    const full = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" }, "full");
    const def = CHAPTERS.protectingYourFamily;
    const original = def.available;
    try {
      def.available = () => false;
      expect(printedChapters(full)).toContain("protectingYourFamily");
    } finally {
      def.available = original;
    }
  });
});

describe("estimatePlanStoryPageCount", () => {
  // document.tsx calls this with NO data — it must work from options alone.
  it("counts one page per chapter that will actually print", () => {
    // Two, not three: the default picks no scenario, so the recommendation
    // chapter cannot render and must not be numbered.
    expect(estimatePlanStoryPageCount(undefined as never, PLAN_STORY_OPTIONS_DEFAULT)).toBe(2);
    expect(estimatePlanStoryPageCount(undefined as never, WITH_PROPOSAL)).toBe(3);
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
    expect(estimatePlanStoryPageCount(junk, PLAN_STORY_OPTIONS_DEFAULT)).toBe(2);
  });
});

describe("summarizePlanStoryOptions", () => {
  it("names the preset and the number of chapters that will print", () => {
    expect(summarizePlanStoryOptions(PLAN_STORY_OPTIONS_DEFAULT)).toBe("Full story · 2 chapters");
    expect(summarizePlanStoryOptions(WITH_PROPOSAL)).toBe("Full story · 3 chapters");
  });

  it("says one chapter in the singular", () => {
    expect(summarizePlanStoryOptions(applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief"))).toBe(
      "Executive brief · 1 chapter",
    );
  });

  it("names a hand-tuned report Custom", () => {
    const custom: PlanStoryOptions = {
      ...withSections({ whatYouHave: false, whatWeRecommend: false }),
      scenarioId: "scn-1",
      preset: "custom",
    };
    expect(summarizePlanStoryOptions(custom)).toBe("Custom · 1 chapter");
  });

  it("counts the full preset's fourteen chapters", () => {
    expect(summarizePlanStoryOptions(applyPreset(WITH_PROPOSAL, "full"))).toBe(
      "Full story · 14 chapters",
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
  // The presets are the SPEC's shape, not today's: `full` turns on all fourteen
  // even though eleven narrators land in Wave D. `PLAN_STORY_OPTIONS_DEFAULT` is
  // the conservative one, and the pair of tests above pins that difference.
  it("Full story turns on every chapter", () => {
    const o = applyPreset(WITH_PROPOSAL, "full");
    expect(printedChapters(o)).toHaveLength(14);
  });

  it("Executive brief is exactly the spec's 0, 5 and 6", () => {
    const o = applyPreset(WITH_PROPOSAL, "brief");
    expect(printedChapters(o)).toEqual(["planInOnePage", "whatWeRecommend", "willTheMoneyLast"]);
  });

  it("Executive brief writes in the front-matter register", () => {
    expect(applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief").documentRole).toBe("frontMatter");
  });

  it("drops the five comparison chapters on a base-only story", () => {
    const o = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "" }, "full");
    const printed = printedChapters(o);
    expect(printed).not.toContain("whatWeRecommend");
    expect(printed).not.toContain("willTheMoneyLast");
    expect(printed).toHaveLength(9);
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
