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
import { CHAPTERS, NARRATED_CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS, type ChapterId, type StoryContext } from "@/lib/presentations/story/types";

/** Every chapter, switched on or off by one rule — so a new chapter joins the
 *  presets by joining `CHAPTER_IDS`, and cannot be silently left out of one. */
function sectionsWhere(on: (id: ChapterId) => boolean): Record<ChapterId, boolean> {
  return Object.fromEntries(CHAPTER_IDS.map((id) => [id, on(id)])) as Record<ChapterId, boolean>;
}

/** The spec's Executive brief: the punchline, the recommendations, and whether
 *  the money lasts. */
const BRIEF_CHAPTERS: readonly ChapterId[] = [
  "planInOnePage",
  "whatWeRecommend",
  "willTheMoneyLast",
];

/** What a stored deck and a freshly added page start as: the chapters that have
 *  a narrator, and nothing else. The `full` preset below is the spec's shape
 *  rather than today's, so switching to it is what turns the rest on. */
const DEFAULT_SECTIONS = sectionsWhere((id) => NARRATED_CHAPTERS.includes(id));

export const planStoryOptionsSchema = z.object({
  preset: z.enum(["full", "brief", "custom"]).default("full"),
  documentRole: z.enum(["standalone", "frontMatter"]).default("standalone"),
  /** The scenario whose changes the story presents. Empty = base-only story. */
  scenarioId: z.string().default(""),
  // One key per chapter of the arc, in document order. The eleven whose
  // narrators have not landed default to FALSE — a deck stored today, and a page
  // freshly added to one, both render exactly the three-chapter report the app
  // renders now. The `full` preset below is the spec's shape rather than
  // today's, so switching to it is what turns the rest on.
  sections: z
    .object({
      planInOnePage: z.boolean().default(true),
      whatWerePlanningFor: z.boolean().default(false),
      whatYouHave: z.boolean().default(true),
      whereTheMoneyGoes: z.boolean().default(false),
      thePathYoureOn: z.boolean().default(false),
      whatWeRecommend: z.boolean().default(true),
      willTheMoneyLast: z.boolean().default(false),
      whatYouCanSpend: z.boolean().default(false),
      whatsLeftForPeople: z.boolean().default(false),
      whatYoullPayInTax: z.boolean().default(false),
      protectingYourFamily: z.boolean().default(false),
      healthCareCosts: z.boolean().default(false),
      whatHappensNext: z.boolean().default(false),
      thingsToKnow: z.boolean().default(false),
    })
    .default(DEFAULT_SECTIONS),
});

export type PlanStoryOptions = z.infer<typeof planStoryOptionsSchema>;

export const PLAN_STORY_OPTIONS_DEFAULT: PlanStoryOptions = {
  preset: "full",
  documentRole: "standalone",
  scenarioId: "",
  sections: DEFAULT_SECTIONS,
};

export type PresetId = "full" | "brief";

/** The short front-of-deck version is a PRESET, not a second report: the
 *  punchline and the recommendations, written to point at the pages after. */
export const PRESETS: Record<PresetId, Pick<PlanStoryOptions, "documentRole" | "sections">> = {
  /** The standalone client document — everything applicable, ~12-16 pages. */
  full: {
    documentRole: "standalone",
    sections: sectionsWhere(() => true),
  },
  /**
   * Three pages of front matter ahead of an existing deck — the spec's chapters
   * 0, 5 and 6. Not a second product: the same sections model, the same storage,
   * and `documentRole` switching the prose from self-contained to pointing at
   * the pages that follow.
   */
  brief: {
    documentRole: "frontMatter",
    sections: sectionsWhere((id) => BRIEF_CHAPTERS.includes(id)),
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
 * Three rules now, not two: the advisor switched it on, it has a plan to
 * recommend, AND it has something in it. A chapter marked `requiresProposal` has
 * nothing to recommend on a base-only story — `plan-story/generate/route.ts`
 * never even generates it, and a shipped test pins that — so counting it would
 * reserve a page the render never fills. The third is the coverage rule (no
 * policies, no insurance chapter) and it lives here for the same reason:
 * `estimatePlanStoryPageCount` reserves sheets from this function and
 * `documentSections` numbers the contents from that reservation, so a chapter
 * that self-hides at render time and not at count time drifts the whole deck.
 *
 * `ctx` is optional and the availability rule is SKIPPED when it is absent —
 * `document.tsx` calls the estimate with no data at all. That asymmetry is
 * deliberate, and it is why `available` may only depend on things the OPTIONS
 * also imply: a coverage chapter that hides on data the estimate cannot see
 * would reserve a sheet the render never fills, which is the page-count defect
 * arriving a third time. A chapter that genuinely needs data the options cannot
 * imply must print an honest short empty state on its reserved sheet instead.
 *
 * Deliberately not two functions. "Switched on" is `options.sections[id]` and
 * anything that genuinely wants it can read it; a second exported helper is how
 * the count and the render came apart in the first place.
 */
export function printedChapters(options: PlanStoryOptions, ctx?: StoryContext): ChapterId[] {
  const hasProposal = planStoryHasProposal(options);
  return CHAPTER_IDS.filter((id) => {
    const def = CHAPTERS[id];
    if (!options.sections[id]) return false;
    if (def.requiresProposal && !hasProposal) return false;
    if (ctx && def.available && !def.available(ctx)) return false;
    return true;
  });
}
