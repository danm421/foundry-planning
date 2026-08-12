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
import { CHAPTER_IDS } from "@/lib/presentations/story/types";

/** The same options with a live scenario picked — the only thing that makes the
 *  recommendation chapter printable. */
const WITH_PROPOSAL: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };

function withSections(over: Partial<PlanStoryOptions["sections"]>): PlanStoryOptions {
  return {
    ...PLAN_STORY_OPTIONS_DEFAULT,
    sections: { ...PLAN_STORY_OPTIONS_DEFAULT.sections, ...over },
  };
}

describe("planStoryOptionsSchema", () => {
  it("defaults to the full story, standalone, with no scenario picked", () => {
    const parsed = planStoryOptionsSchema.parse({});
    expect(parsed.preset).toBe("full");
    expect(parsed.documentRole).toBe("standalone");
    expect(parsed.scenarioId).toBe("");
    expect(parsed.sections).toEqual({
      planInOnePage: true,
      whatYouHave: true,
      whatWeRecommend: true,
    });
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
    expect(parsed.sections).toEqual({
      planInOnePage: false,
      whatYouHave: true,
      whatWeRecommend: true,
    });
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
    // Driven off CHAPTERS rather than a hard-coded list, so a fourth chapter
    // cannot be added without this rule being applied to it.
    const baseOnly = printedChapters(PLAN_STORY_OPTIONS_DEFAULT);
    const proposed = printedChapters(WITH_PROPOSAL);
    for (const id of CHAPTER_IDS) {
      expect(proposed).toContain(id);
      expect(baseOnly.includes(id)).toBe(!CHAPTERS[id].requiresProposal);
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
    const brief = applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief");
    expect(estimatePlanStoryPageCount(undefined as never, brief)).toBe(1);
    expect(estimatePlanStoryPageCount(undefined as never, applyPreset(WITH_PROPOSAL, "brief"))).toBe(2);
  });

  it("never reports zero, so an all-off report still occupies a page", () => {
    const none = withSections({ planInOnePage: false, whatYouHave: false, whatWeRecommend: false });
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
      ...WITH_PROPOSAL,
      preset: "custom",
      sections: { planInOnePage: true, whatYouHave: false, whatWeRecommend: false },
    };
    expect(summarizePlanStoryOptions(custom)).toBe("Custom · 1 chapter");
  });

  it("agrees with the page count the launcher row shows beside it", () => {
    for (const options of [PLAN_STORY_OPTIONS_DEFAULT, WITH_PROPOSAL, applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief")]) {
      const stated = Number(/·\s(\d+)\schapter/u.exec(summarizePlanStoryOptions(options))![1]);
      expect(stated).toBe(estimatePlanStoryPageCount(undefined as never, options));
    }
  });
});
