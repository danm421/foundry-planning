// The Plan Story page's options — and the ONE place the report's chapter list
// is decided.
//
// `printedChapters` is that place, and three things have to agree with it:
// `estimatePlanStoryPageCount`, which `document.tsx` calls with NO data to
// number every page in the deck; `summarizePlanStoryOptions`, which tells the
// advisor how long the report is; and `buildPlanStoryData`, which decides what
// actually renders.
//
// They did not agree as planned. The estimate counted the section toggles alone
// while the builder ALSO dropped any chapter needing a proposal, so the default
// deck — no scenario picked — estimated three pages and rendered two. That is
// not an edge case: `document.tsx` accumulates both the running page numbers and
// the deck's total from the estimate, so a base-only story mis-numbered every
// page after it, overstated the total on every page of the document, and put a
// wrong start page in the table of contents.
//
// "Does this story have a proposal" turns out to be a pure function of the
// options, which is what makes one filter possible: the export loader turns
// `scenarioId` into a proposed ref by exactly the rule `planStoryProposedRef`
// states, and `loadStoryContext` sets `hasProposal` from that ref being
// non-null. So the count and the render are the same call rather than two
// filters that happen to agree today.
//
// Zod 4: declare defaults with `.default(...)` ALONE. `.optional().default(...)`
// wraps the default in an optional and the field stops defaulting.
import { z } from "zod";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS, type ChapterId } from "@/lib/presentations/story/types";

export const planStoryOptionsSchema = z.object({
  preset: z.enum(["full", "brief", "custom"]).default("full"),
  documentRole: z.enum(["standalone", "frontMatter"]).default("standalone"),
  /** The scenario whose changes the story presents. Empty = base-only story. */
  scenarioId: z.string().default(""),
  sections: z
    .object({
      planInOnePage: z.boolean().default(true),
      whatYouHave: z.boolean().default(true),
      whatWeRecommend: z.boolean().default(true),
    })
    .default({ planInOnePage: true, whatYouHave: true, whatWeRecommend: true }),
});

export type PlanStoryOptions = z.infer<typeof planStoryOptionsSchema>;

export const PLAN_STORY_OPTIONS_DEFAULT: PlanStoryOptions = {
  preset: "full",
  documentRole: "standalone",
  scenarioId: "",
  sections: { planInOnePage: true, whatYouHave: true, whatWeRecommend: true },
};

export type PresetId = "full" | "brief";

/** The short front-of-deck version is a PRESET, not a second report: the
 *  punchline and the recommendations, written to point at the pages after. */
export const PRESETS: Record<PresetId, Pick<PlanStoryOptions, "documentRole" | "sections">> = {
  full: {
    documentRole: "standalone",
    sections: { planInOnePage: true, whatYouHave: true, whatWeRecommend: true },
  },
  brief: {
    documentRole: "frontMatter",
    sections: { planInOnePage: true, whatYouHave: false, whatWeRecommend: true },
  },
};

/** A preset changes which chapters print and how they are written. It
 *  deliberately does not touch `scenarioId` — the plan being presented is not
 *  part of the report's shape, and blanking it would silently delete the
 *  recommendation chapter the moment an advisor switched preset. */
export function applyPreset(options: PlanStoryOptions, preset: PresetId): PlanStoryOptions {
  return { ...options, preset, ...PRESETS[preset] };
}

/**
 * The scenario ref this story narrates, or null for a base-only story.
 *
 * The single spelling of that rule. `plan-story/generate/route.ts` writes it as
 * `scenarioId === "base" ? null : scenarioId` over an id its resolver has
 * already validated; the export loader reaches the same answer from a raw
 * options field that can also be empty. Both have to agree with
 * `printedChapters` — the moment they differ the deck's page numbering is wrong
 * — so there is one function and everything calls it.
 */
export function planStoryProposedRef(scenarioId: string): string | null {
  return scenarioId.length > 0 && scenarioId !== "base" ? scenarioId : null;
}

/** True when the options name a plan to recommend, which is the condition the
 *  chapters marked `requiresProposal` render under. */
export function planStoryHasProposal(options: PlanStoryOptions): boolean {
  return planStoryProposedRef(options.scenarioId) !== null;
}

/**
 * The chapters this report will PRINT, in document order.
 *
 * Two rules, not one: the advisor switched it on, AND it has something to say.
 * A chapter marked `requiresProposal` has nothing to recommend on a base-only
 * story — `plan-story/generate/route.ts` never even generates it, and a shipped
 * test pins that — so counting it would reserve a page the render never fills.
 *
 * Deliberately not two functions. "Switched on" is `options.sections[id]` and
 * anything that genuinely wants it can read it; a second exported helper is how
 * the count and the render came apart in the first place.
 */
export function printedChapters(options: PlanStoryOptions): ChapterId[] {
  const hasProposal = planStoryHasProposal(options);
  return CHAPTER_IDS.filter(
    (id) => options.sections[id] && (hasProposal || !CHAPTERS[id].requiresProposal),
  );
}
