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
import {
  CHAPTER_IDS,
  CHAPTER_LENGTHS,
  CHAPTER_TONES,
  DEFAULT_CHAPTER_STYLE,
  type ChapterId,
  type ChapterStyle,
} from "@/lib/presentations/story/types";

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

/** What a stored deck and a freshly added page start as: the whole arc. Every
 *  chapter has a narrator, so every one has something true to print. */
const DEFAULT_SECTIONS = sectionsWhere(() => true);

/**
 * One key per chapter of the arc, each defaulting ON.
 *
 * The PER-KEY defaults matter separately from the object-level
 * `.default(DEFAULT_SECTIONS)`: that one covers a deck that stored no
 * `sections` at all, while these are what Zod applies to a deck that stored a
 * PARTIAL one — every deck saved before a chapter existed. While the arc was
 * landing a chapter at a time these were built from the narrated list, and the
 * two lists drifted once: a chapter was on in a fresh page and off in a saved
 * one. One rule now, and it is the same rule `DEFAULT_SECTIONS` reads.
 */
const sectionShape = Object.fromEntries(
  CHAPTER_IDS.map((id) => [id, z.boolean().default(DEFAULT_SECTIONS[id])]),
) as Record<ChapterId, z.ZodDefault<z.ZodBoolean>>;

/**
 * How ONE chapter is written: the advisor's register and how much prose to ask
 * for. Both default, so a deck that stored a half-filled entry gets the rest.
 *
 * ONE schema object, reused for all fourteen keys rather than rebuilt per key.
 * Zod schemas are immutable and all fourteen defaults are the same, so sharing
 * changes nothing at runtime — and `typeof chapterStyleSchema` is a generic that
 * cannot go stale when a third tone is added, which a hand-spelled one can.
 * (`sectionShape` above spells its generic out only because `ZodBoolean` takes
 * no type argument. `ZodEnum` does, and in Zod 4 it is an entries OBJECT, not
 * the tuple Zod 3 took.)
 */
export const chapterStyleSchema = z
  .object({
    tone: z.enum(CHAPTER_TONES).default(DEFAULT_CHAPTER_STYLE.tone),
    length: z.enum(CHAPTER_LENGTHS).default(DEFAULT_CHAPTER_STYLE.length),
  })
  .default(DEFAULT_CHAPTER_STYLE);

/**
 * One key per chapter. The PER-KEY defaults matter separately from the
 * object-level one for the same reason `sectionShape`'s do: a deck saved before
 * a chapter existed stores a PARTIAL map, and these are what fill it.
 */
const styleShape = Object.fromEntries(
  CHAPTER_IDS.map((id) => [id, chapterStyleSchema]),
) as Record<ChapterId, typeof chapterStyleSchema>;

/** Every chapter at the default, each key its OWN object.
 *
 *  The object-level `.default()` hands this same map back on every parse
 *  (measured; `sections` has the property too), so without the copy all fourteen
 *  keys would alias one `DEFAULT_CHAPTER_STYLE` and a caller editing one entry in
 *  place would edit the other thirteen — and the module constant with them. The
 *  same hazard `PRESETS.full` copies its way out of below. */
const DEFAULT_CHAPTER_STYLES = Object.fromEntries(
  CHAPTER_IDS.map((id) => [id, { ...DEFAULT_CHAPTER_STYLE }]),
) as Record<ChapterId, ChapterStyle>;

export const planStoryOptionsSchema = z.object({
  preset: z.enum(["full", "brief", "custom"]).default("full"),
  documentRole: z.enum(["standalone", "frontMatter"]).default("standalone"),
  /** The scenario whose changes the story presents. Empty = base-only story. */
  scenarioId: z.string().default(""),
  sections: z.object(sectionShape).default(DEFAULT_SECTIONS),
  /**
   * How each chapter is written. Deliberately NOT read by `printedChapters` —
   * style changes the prose, never which sheets the deck reserves. The test
   * `does not change which chapters print` is what holds that.
   */
  chapterStyle: z.object(styleShape).default(DEFAULT_CHAPTER_STYLES),
});

export type PlanStoryOptions = z.infer<typeof planStoryOptionsSchema>;

export const PLAN_STORY_OPTIONS_DEFAULT: PlanStoryOptions = {
  preset: "full",
  documentRole: "standalone",
  scenarioId: "",
  sections: DEFAULT_SECTIONS,
  chapterStyle: DEFAULT_CHAPTER_STYLES,
};

export type PresetId = "full" | "brief";

/**
 * The short front-of-deck version is a PRESET, not a second report: the
 * punchline and the recommendations, written to point at the pages after.
 */
export const PRESETS: Record<PresetId, Pick<PlanStoryOptions, "documentRole" | "sections">> = {
  /** The standalone client document — everything applicable, ~12-16 pages.
   *  The DEFAULT's own object, copied: applying this preset to a fresh page has
   *  to be a no-op, and two independent `sectionsWhere` calls that agree today
   *  are how that stops being true. Copied rather than shared so the exported
   *  default and the preset cannot alias one mutable object. */
  full: {
    documentRole: "standalone",
    sections: { ...DEFAULT_SECTIONS },
  },
  /**
   * Three pages of front matter ahead of an existing deck — the spec's chapters
   * 0, 5 and 6. Not a second product: the same sections model, the same storage,
   * and `documentRole` switching the prose from self-contained to pointing at
   * the pages that follow.
   *
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
 * Two rules, and both are answerable from the OPTIONS ALONE: the advisor
 * switched it on, and it has a plan to recommend. A chapter marked
 * `requiresProposal` has nothing to recommend on a base-only story —
 * `plan-story/generate/route.ts` never even generates it, and a shipped test
 * pins that — so counting it would reserve a page the render never fills.
 *
 * IT TAKES NO CONTEXT, AND THAT IS THE CONTRACT. `estimatePlanStoryPageCount`
 * reserves sheets from this function with no data at all (`document.tsx` calls
 * it as `estimatePageCount(undefined as never, options)`), and
 * `documentSections` numbers the table of contents from that reservation. A
 * third rule that could see the story data would hide a chapter at render time
 * that the count had already reserved a sheet for — which mis-numbers every page
 * after it and overstates the total on all of them. That is the page-count
 * defect Plan 1 fixed twice, and a `ctx` parameter here is the third way in.
 *
 * So a coverage chapter with nothing in it for this household KEEPS its sheet
 * and prints a short honest empty state. `ChapterDef.available` exists for the
 * generate route — don't spend a model call on a chapter with nothing to say —
 * and never for the print list. A future change that wants real self-hiding has
 * to move its predicate into something answerable from options alone.
 *
 * Deliberately not two functions. "Switched on" is `options.sections[id]` and
 * anything that genuinely wants it can read it; a second exported helper is how
 * the count and the render came apart in the first place.
 */
export function printedChapters(options: PlanStoryOptions): ChapterId[] {
  const hasProposal = planStoryHasProposal(options);
  return CHAPTER_IDS.filter(
    (id) => options.sections[id] && !(CHAPTERS[id].requiresProposal && !hasProposal),
  );
}
