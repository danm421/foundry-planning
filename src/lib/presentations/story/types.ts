import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import type { Fact } from "./facts";
import type { StoryChartData } from "./charts";

/** The spec's fourteen-chapter arc, in DOCUMENT ORDER. `CHAPTER_IDS` is the
 *  order the report prints in, the order the review panel lists in, and the
 *  order the options control renders in — one list, read by all three. */
export type ChapterId =
  | "planInOnePage"
  | "whatWerePlanningFor"
  | "whatYouHave"
  | "whereTheMoneyGoes"
  | "thePathYoureOn"
  | "whatWeRecommend"
  | "willTheMoneyLast"
  | "whatYouCanSpend"
  | "whatsLeftForPeople"
  | "whatYoullPayInTax"
  | "protectingYourFamily"
  | "healthCareCosts"
  | "whatHappensNext"
  | "thingsToKnow";

export const CHAPTER_IDS: readonly ChapterId[] = [
  "planInOnePage",
  "whatWerePlanningFor",
  "whatYouHave",
  "whereTheMoneyGoes",
  "thePathYoureOn",
  "whatWeRecommend",
  "willTheMoneyLast",
  "whatYouCanSpend",
  "whatsLeftForPeople",
  "whatYoullPayInTax",
  "protectingYourFamily",
  "healthCareCosts",
  "whatHappensNext",
  "thingsToKnow",
] as const;

/**
 * Is this string one of the chapters this build knows about?
 *
 * Storage holds `chapter_id` as free text, so a row outlives the chapter it
 * names — and Plan 2 renames and reorders this union, which is what makes the
 * case reachable rather than theoretical. Without the check, the export loader's
 * cast puts an unknown key into a `Partial<Record<ChapterId, string>>` where
 * nothing reads it and nothing reports it: the chapter prints its deterministic
 * narrative while the advisor's own edited text sits in a row that no longer has
 * a home.
 *
 * Reads `CHAPTER_IDS`, so it cannot drift from the union.
 */
export function isChapterId(value: string): value is ChapterId {
  return (CHAPTER_IDS as readonly string[]).includes(value);
}

/**
 * The register one chapter is written in, chosen by the advisor per chapter.
 *
 * A closed list, and the ONE spelling of it: `options-schema.ts` builds the only
 * `z.enum` over it — the schema the saved deck, the generate body and the
 * staleness query are all validated against — and `prompts.ts` keys a `Record` on
 * the type. So a fourth tone cannot be accepted on one path and refused on
 * another, and cannot reach the prompt without a line to write it in: the
 * compiler asks for one.
 */
export const CHAPTER_TONES = ["warm", "plain", "direct"] as const;
export type ChapterTone = (typeof CHAPTER_TONES)[number];

/** How much prose to ask for. One list, read by the schemas and by the modifier
 *  `registry.ts` keys on it — the same rule as the tones above. */
export const CHAPTER_LENGTHS = ["short", "standard", "full"] as const;
export type ChapterLength = (typeof CHAPTER_LENGTHS)[number];

export interface ChapterStyle {
  tone: ChapterTone;
  length: ChapterLength;
}

/**
 * What a chapter is written in when nobody has said otherwise.
 *
 * ⚠️ Both values are load-bearing, not arbitrary. `TONE_LINE.warm` is the exact
 * sentence the system prompt carried before this setting existed and
 * `LENGTH_MODIFIER.standard` is the empty string, so a default-style prompt is
 * BYTE-IDENTICAL to the pre-setting one — which is what lets a chapter already
 * generated keep its stored `sourceHash` instead of reading stale on the deploy
 * that adds the setting. `chapters/__tests__/prompts.test.ts` pins that against
 * fourteen hashes recorded before the change.
 *
 * ⚠️ ONE EXCEPTION, and it is not the style's: `chapters/prompts.ts#singleLine`
 * NORMALISES the household name fields. A record whose `firstNames` or
 * `householdName` is PADDED with whitespace, or carries a CR or LF ANYWHERE,
 * hashes differently across this deploy and reads stale once, clearing on the
 * next generation. Internal spacing that is neither — a double space, a tab, a
 * U+2028 — is left exactly as stored and moves nothing.
 *
 * Measured, not reasoned, and in the direction the deploy runs: with
 * `firstNames = "  Alan and Teresa  "` the prompts differ in both halves, and
 * the hash the run STORED (`62ce3f36…`) is rebuilt as `b54b08f3…` — which is the
 * hash a clean name has always produced, since the trim makes the two records
 * agree. A name already clean — every fixture, and the ordinary record — is
 * byte-identical.
 */
export const DEFAULT_CHAPTER_STYLE: ChapterStyle = { tone: "warm", length: "standard" };

/**
 * One partial style map, filled out to every chapter.
 *
 * ⭐ ONE spelling, called by BOTH sides of the staleness comparison. The two
 * sides read the map off different transports and cannot share one — the
 * generate route takes a JSON body, the staleness route a GET query — but a
 * chapter the advisor never touched has to resolve to the same style on both, or
 * the hash the run stored is not the hash the check rebuilds and the chapter
 * reads permanently out of date with nothing able to clear it.
 *
 * Each gap is filled with a COPY, so the fourteen keys cannot alias one mutable
 * object; `options-schema.ts` copies its own default map for the same reason.
 */
export function resolveChapterStyles(
  partial: Partial<Record<ChapterId, ChapterStyle>> | undefined,
): Record<ChapterId, ChapterStyle> {
  return Object.fromEntries(
    CHAPTER_IDS.map((id) => [id, partial?.[id] ?? { ...DEFAULT_CHAPTER_STYLE }]),
  ) as Record<ChapterId, ChapterStyle>;
}

export interface StoryHousehold {
  /** "Alan and Teresa" — used sparingly in the prose. */
  firstNames: string;
  /** "the Bradshaw household" — used once, for framing. */
  householdName: string;
}

/** One toggle group's worth of scenario edits, presented as a single idea. */
export interface StoryStrategy {
  name: string;
  rows: ChangeRow[];
}

/**
 * One thing the household wants the money to do, in the client's own words.
 *
 * Deliberately three fields and no amount. A goal's cost is a figure and belongs
 * in the fact pack under Gate 1's rules; the goal itself is a NAME the household
 * typed, which is the one thing on chapter 1 that must reach the client
 * unaltered. `year` is null for an open-ended goal ("leave something for the
 * grandchildren") — those are real and must not be forced onto a timeline.
 *
 * The YEAR is a figure like any other, so it is in the pack too and the narrator
 * reads it back through `factDisplay` rather than printing this field. Keeping
 * the number here as well is what lets `build-facts.ts` put it in the pack; see
 * `goalYearFactId`.
 */
export interface StoryGoal {
  name: string;
  year: number | null;
  /** "Education", "Purchase" — the goal's kind, for grouping. "" when untyped. */
  kind: string;
}

/**
 * One advisor-authored next step, merge tokens already resolved.
 *
 * The only chapter whose BODY is not ours. `text` is the advisor's own sentence
 * and reaches the client unaltered — no gate runs over it, exactly as no gate
 * runs over an advisor's `editedText`: a rule that rewrote an action item would
 * be rewriting an instruction they gave their own client.
 *
 * `owner` and `when` print as one caption beneath the step and are "" when the
 * advisor left the column alone, which is the ordinary case. The chapter's lead
 * paragraph reads them: it may only promise a caption the page will actually
 * print.
 */
export interface StoryStep {
  text: string;
  owner: string;
  when: string;
}

export interface StoryContext {
  household: StoryHousehold;
  scenarioLabel: string;
  /** Switches the prose between self-contained and pointing at the pages after. */
  documentRole: "standalone" | "frontMatter";
  /** False for a no-changes annual review — the recommendation chapters hide. */
  hasProposal: boolean;
  strategies: StoryStrategy[];
  /**
   * What they want the money to do, for the chapter that opens on them rather
   * than on a balance sheet. Empty is an ordinary answer — a household whose
   * goals have not been recorded yet — and chapter 1 says so plainly.
   *
   * Required rather than optional, unlike `nextSteps`: every context is built by
   * `load-context.ts`, which always has the effective tree these come off, so an
   * absent array would only ever mean a caller forgot. The compiler asking is
   * the point.
   */
  goals: StoryGoal[];
  facts: Fact[];
  /**
   * The chart data the chart chapters draw — see `story/charts.ts`. `estate`
   * is a `StoryEstateChart` object (a `comparison` plus a `bars` array), not
   * an array itself; `tax` and `portfolio` are arrays.
   *
   * Optional because a caller with no projection (the review panel's own
   * fixtures, and every test that builds a context by hand) has nothing to put
   * here, and a chapter whose chart is absent prints its prose alone. NOT a
   * signal that the household is chartless: `charts.estate` carries that.
   */
  charts?: StoryChartData;
  /**
   * What each of them does next, for the one chapter that prints a list rather
   * than prose. Absent means none — a household with no agreed next steps gets
   * the chapter's lead paragraph and nothing under it.
   *
   * Not facts: a step is a sentence with an owner and a date, and the fact pack
   * is figures the model may quote. `load-next-steps.ts` fills it from the
   * observations layer's own next-step rows.
   */
  nextSteps?: StoryStep[];
}

/**
 * The figures one chapter may use — the pack minus anything scoped to other
 * chapters. A fact with no `chapters` is a plan-level total and belongs
 * everywhere.
 *
 * The single place that filter is written. What the model is SHOWN and what
 * Gate 1 ALLOWS have to be the same set: show a figure the gate will reject and
 * the chapter spends its one retry on a word we handed it, and allow a figure
 * the model was never shown and the scoping does nothing. `generate.ts` applies
 * this once, at the top, and everything downstream reads the result — so the
 * two sets are the same array rather than two filters that agree today.
 */
export function factsForChapter(facts: Fact[], chapterId: ChapterId): Fact[] {
  return facts.filter((f) => !f.chapters || f.chapters.includes(chapterId));
}

/** The whole fact, for the rare narrative that has to COMPARE two figures rather
 *  than print one. `raw` is the only safe way to do that: `display` is rounded
 *  for the page, so "91%" and "90.6%" can be the same string at one decimal. */
export function findFact(ctx: StoryContext, id: string): Fact | null {
  return ctx.facts.find((f) => f.id === id) ?? null;
}

/**
 * Look a fact up by id. Returns the pre-formatted display string, or null.
 * Narratives and prompts read figures through this, so nothing can put an
 * unformatted number on the page.
 *
 * One deliberate exception: `chapters/what-we-recommend.ts` quotes a
 * `ChangeRow.detail` written by another module. That text never passes through
 * here, so it is checked against the fact gate AND against the fact pack's
 * spellings before it is printed, and dropped when it fails either. Any future
 * chapter that quotes text it did not build owes the same check.
 */
export function factDisplay(ctx: StoryContext, id: string): string | null {
  return findFact(ctx, id)?.display ?? null;
}
