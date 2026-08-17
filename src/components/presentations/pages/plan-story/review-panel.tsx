// The advisor's review surface, and the control that earns the report's lack
// of an "AI-generated" marker: every word here is read and owned by a human
// before a client sees it.
//
// Three things it must not get wrong:
//
// 1. It reports the state the export gate rests on. An empty list is "not
//    loaded yet", never "all clear" — so the summary line is withheld until a
//    GET has actually answered. Otherwise a 403 or a 500 renders the words
//    "All chapters reviewed" over zero chapters read by nobody.
// 2. A chapter can be missing for two unrelated reasons that look identical in
//    storage: the gates rejected the prose (`aiSuppressed`, no `error`), or the
//    assistant itself failed (`error` set). An outage files no gate findings,
//    so deriving the reason from the suppression flag alone explains an outage
//    with a blank.
// 3. The stored text is shown as stored. The PDF renderer applies its own
//    drop rules at print time; re-spelling any of them here is how the two
//    surfaces would start disagreeing about what the advisor approved.
"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
// The same split the printed sheet uses, from a module whose own import closure
// is one module — itself. See its header for why it is not `view-model.ts`.
import { splitParagraphs } from "@/lib/presentations/pages/plan-story/paragraphs";
import { sampleRefusal } from "@/lib/presentations/story/voice/refusal";
import { chapterIgnoresFullLength } from "@/lib/presentations/story/chapters/registry";
import {
  CHAPTER_IDS,
  CHAPTER_LENGTHS,
  CHAPTER_TONES,
  isChapterId,
  resolveChapterStyles,
  type ChapterId,
  type ChapterLength,
  type ChapterStyle,
  type ChapterTone,
} from "@/lib/presentations/story/types";

interface ChapterRow {
  chapterId: string;
  title: string;
  text: string;
  generated: boolean;
  edited: boolean;
  aiSuppressed: boolean;
  error: string | null;
  reviewed: boolean;
  /**
   * Could a generation write this chapter for this story at all? Read off the
   * chapter list, never derived here: the route answers it from the same
   * function the generate route refuses with, so the button and the refusal
   * cannot disagree. Only its FALSE half is reliable — the route's own note
   * says why.
   *
   * ⚠️ Optional, and read as `!== false` below, so a payload that does not
   * answer shows every button and lets the route refuse. A missing field must
   * never read as "nothing here can be written".
   */
  candidate?: boolean;
  /**
   * The model's rewrite, when it is NEWER than the advisor's edit and therefore
   * stored without being what prints — null on every ordinary row.
   *
   * The prose itself rather than a flag, because the advisor is being asked
   * whether to discard their own words for these: a click that says "use the
   * new version" without showing the new version is not a choice.
   *
   * Decided by the route (`hasNewerGeneration`, `story/repo.ts`), never here.
   * Both timestamps it reads live in storage, and re-deriving "which of these
   * two is newer" in a client component from fields this payload does not even
   * carry is how the panel would come to offer the swap over prose nothing
   * superseded.
   */
  newerGeneratedText?: string | null;
}

/**
 * Which chapters were written from a plan that has since moved.
 *
 * ⚠️⚠️ ITS OWN REQUEST, and its own state, for two separate reasons.
 *
 * Its own REQUEST because answering costs a whole story context — measured at
 * 23.2s cold and 4.0s warm — and the chapter list is reloaded after every save.
 * A `stale` field on that list would put four seconds behind every blur.
 *
 * Its own STATE for the same reason from the other end: if the flags arrived on
 * the list payload, every post-save reload would replace them, and the badges
 * would blink off the moment an advisor edited anything.
 *
 * Asked for ONCE, on mount. The answer moves again only when something is
 * rewritten — a whole run or one chapter — and both of those are answered
 * without asking it a second time; see `clearOutOfDate`.
 */
const CHAPTER_OUT_OF_DATE =
  "The plan has changed since this chapter was written. Generate again to bring it up to date.";

/**
 * What `story/generate.ts` stores in `error`, and what the advisor is told it
 * means. The keys are that module's two frozen constants (generate.ts:33, :37).
 *
 * Matched by value rather than imported: `generate.ts` reaches Azure and Redis,
 * and this is a client component. Anything unrecognised renders as stored — so
 * a reworded constant degrades to its own plain sentence rather than to
 * silence.
 */
const REASONS: Record<string, string> = {
  "The writing assistant was unavailable.":
    "The writing assistant didn't answer, so this chapter is written from the plan's own figures. Generate again to retry.",
  "The writing assistant returned too little text to use.":
    "The writing assistant sent back too little to use, so this chapter is written from the plan's own figures. Generate again to retry.",
};

/**
 * What the advisor is told when the request itself failed — as opposed to when
 * the assistant did. No status codes and no "error": the number is in the
 * console for whoever debugs it, and none of them changes what the advisor
 * does next. Each one says what did NOT happen, so a failure can never read
 * like a save that landed.
 */
const COULD_NOT_LOAD =
  "Couldn't load this report's chapters. Check your connection and try again.";
const COULD_NOT_SAVE = "Couldn't save your edit. Your words are still in the box — try again.";
const COULD_NOT_REVIEW = "Couldn't mark that chapter reviewed. Try again.";
/** Its own sentence rather than `COULD_NOT_REVIEW`'s: the chapter is still
 *  marked reviewed, which is the opposite of what that one says. */
const COULD_NOT_UNREVIEW = "Couldn't undo that chapter's review. Try again.";
/** Its own sentence rather than `COULD_NOT_SAVE`'s: the advisor typed nothing
 *  here, so "your words are still in the box" would be about a box they never
 *  touched — and what they need to know is that their version still prints. */
const COULD_NOT_ACCEPT =
  "Couldn't switch to the new version. Your own words are still what prints — try again.";
const COULD_NOT_GENERATE =
  "Couldn't write the chapters. Nothing was generated — try again in a moment.";
const COULD_NOT_REGENERATE =
  "Couldn't rewrite this chapter. The words on screen are unchanged — try again.";
const COULD_NOT_HARVEST = "Couldn't save that as a voice sample. Nothing was stored — try again.";

/**
 * What a harvested sample is, and — the load-bearing half — what it is NOT yet.
 *
 * The words on this row were written for one household and are being kept to
 * shape the prose of another's report. Nothing is sent to the model until the
 * advisor goes and switches it on, and that sentence is the entire consent
 * story of edits-as-exemplars: an advisor who presses this button and reads
 * nothing about what happens next has not been asked.
 */
const HARVESTED = "Saved to your voice samples. It's off until you turn it on in Settings → Voice.";

const WHOLE_STORY = "The whole story";

/**
 * What a chapter with no words says — and there are TWO answers, because a
 * heading over a blank reads as a rendering failure either way and the reason is
 * not the same.
 *
 * `NOTHING_TO_READ` is the ordinary one: nobody has written it yet, and pressing
 * Generate all would. `NEEDS_A_PROPOSAL` is for a row the report can never
 * write, and "yet" there is a promise it cannot keep — the advisor would wait
 * for prose that has nothing to come from. Told apart by `candidate`, the flag
 * the Regenerate button already branches on further down: `storyCandidates`
 * (`chapters/registry.ts`) clears it on the five `requiresProposal` chapters —
 * `whatWeRecommend`, `willTheMoneyLast`, `whatYouCanSpend`, `whatsLeftForPeople`
 * and `whatYoullPayInTax` — whenever the story is base-only.
 *
 * ⚠️ Deliberately NOT `statusLabel`'s "Not generated yet". That answers a
 * different question: a chapter the advisor generated and then emptied is
 * "Edited" by that label and still has nothing to read. These are about the
 * WORDS, which is what a read-through is for.
 */
const NOTHING_TO_READ = "Nothing written for this chapter yet.";
const NEEDS_A_PROPOSAL = "This chapter needs a proposal to recommend, so this report won't write it.";

/**
 * The advisor's words for the two settings. Keyed on the stored value, so a
 * fourth tone has to be given a label rather than printing its own id.
 */
const TONE_LABELS: Record<ChapterTone, string> = {
  warm: "Warm",
  plain: "Plain",
  direct: "Direct",
};

const LENGTH_LABELS: Record<ChapterLength, string> = {
  short: "Short",
  standard: "Standard",
  full: "Full",
};

/**
 * Shown on the two chapters whose sheet prints a list under the prose, and only
 * while `full` is picked.
 *
 * ⚠️ Load-bearing rather than polite. `chapterIgnoresFullLength` marks the
 * chapters where the length modifier is suppressed before the prompt is built,
 * so `full` produces the same prompt and the same `sourceHash` as `standard`:
 * without this line the advisor changes the setting, presses Regenerate, waits
 * out a model call, and reads the identical paragraph back with nothing on
 * screen to explain it.
 */
const FULL_IS_INERT = "This chapter prints a fixed list, so Full reads the same as Standard.";

/** The row's own small-caps caption, matching the status label in its header
 *  and the group legends in the options control above it. */
const FIELD_CAPTION = "text-[11px] uppercase tracking-[0.1em] text-ink-3";

/** Dense-panel select: the options control's field styling at the row's own
 *  `text-xs`, so fourteen of these read as part of the row rather than as
 *  fourteen forms. */
const FIELD_SELECT =
  "rounded border border-hair bg-card-2 px-1.5 py-1 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

/**
 * What a refused generation says — the firm's ceiling, or `generic`.
 *
 * The ceiling gets its own sentence: nothing is broken, and the answer is to
 * wait, which is exactly what a message the advisor reads as a glitch gets
 * pressed again through. The route sends the wait in seconds on `Retry-After`
 * (`rate-limit.ts`); when that header is missing or unreadable the reason still
 * stands, just without the number.
 *
 * Only 429. A 503 is the limiter itself failing closed — waiting a minute does
 * not fix a missing configuration, so it takes the generic message and the
 * advisor stops rather than counting down.
 */
function generationFailure(res: Response, generic: string): string {
  if (res.status !== 429) return generic;
  const seconds = Number(res.headers.get("retry-after"));
  const wait =
    Number.isFinite(seconds) && seconds > 0
      ? `Try again in about ${Math.ceil(seconds)} seconds.`
      : "Try again shortly.";
  return `Your firm has generated a lot of chapters in the last minute. ${wait}`;
}

/** One key gone, as a new object — the shape React state updates need. Both of
 *  this panel's per-chapter maps drop a key on the same event. */
function without(map: Record<string, string>, key: string): Record<string, string> {
  const next = { ...map };
  delete next[key];
  return next;
}

function statusLabel(row: ChapterRow): string {
  if (!row.generated) return "Not generated yet";
  if (row.aiSuppressed) return "Written from plan figures";
  return row.edited ? "Edited" : "Generated";
}

/** "" until a GET has answered — an empty list is "not loaded yet", never "all
 *  clear" (rule 1 above). Separated out so the live region below can be rendered
 *  whether or not it has anything to say yet. */
function reviewSummary(loaded: boolean, unreviewed: number): string {
  if (!loaded) return "";
  if (unreviewed === 0) return "All chapters reviewed";
  return `${unreviewed} chapter${unreviewed === 1 ? "" : "s"} not yet reviewed`;
}

/** "…" until `loadFacts` has answered — a synthesized "0" here would tell the
 *  advisor a chapter may use no figures while the real answer is still in
 *  flight or never arrived, which is wrong rather than merely missing. */
function factsCount(loaded: boolean, count: number): string {
  return loaded ? String(count) : "…";
}

export function PlanStoryReviewPanel({
  clientId,
  scenarioId,
  documentRole,
  chapterStyle,
  onChapterStyleChange,
}: {
  clientId: string;
  /** The options' scenario. Empty means a base-only story. */
  scenarioId: string;
  /**
   * The register the chapters are written in, straight off the report's options.
   * This is the ONLY route into `StoryContext.documentRole` — the generate route
   * has no other production caller — so the Executive brief preset's entire
   * behaviour ("point at the pages that follow" rather than "close the thought")
   * lives or dies on it being sent. Required, not defaulted: a default here is
   * indistinguishable from the bug it replaced.
   */
  documentRole: "standalone" | "frontMatter";
  /**
   * How each chapter is written, as the deck stored it.
   *
   * PARTIAL, because that is what the panel is handed in tests and what a deck
   * saved before this setting existed holds; the page passes the complete
   * schema-defaulted map, which satisfies it. Every gap is filled through
   * `resolveChapterStyles` — the same helper both routes fill theirs with — so a
   * chapter nobody restyled reaches the same style on all three sides.
   */
  chapterStyle: Partial<Record<ChapterId, ChapterStyle>>;
  /**
   * ⚠️ REQUIRED, and the style is NOT held here.
   *
   * It lives in the report's options: that is what survives a reload, what the
   * export reads, and what the saved deck stores. Panel-local state would look
   * right on screen and print in the wrong voice.
   */
  onChapterStyleChange: (chapterId: ChapterId, style: ChapterStyle) => void;
}) {
  // The routes want the literal "base" for a base-only story: their schema
  // requires a non-empty id (`schemas/plan-story.ts`) and
  // `resolveStoryScenarioId` maps a missing one to "base". The options spell
  // the same thing as "", so it is translated once, here.
  const scenario = scenarioId || "base";

  /**
   * Every chapter's style, gaps filled — the ONE value both transports are
   * built from, so the body the run is written with and the query the freshness
   * check is rebuilt from cannot spell the defaults differently.
   */
  const styles = useMemo(() => resolveChapterStyles(chapterStyle), [chapterStyle]);

  /**
   * The same map as repeated flat parameters, for the staleness GET:
   * `style=planInOnePage:direct:full&style=…`, all fourteen.
   *
   * ⚠️ A STRING, and that is the point of the memo. `loadOutOfDate` keys on this
   * rather than on `styles`, so a parent re-render handing down an equal-but-new
   * object leaves it byte-identical — and the check does not spend another
   * twenty seconds rebuilding a story context to answer the same question.
   */
  const styleQuery = useMemo(
    () =>
      CHAPTER_IDS.map(
        (id) =>
          `style=${encodeURIComponent(`${id}:${styles[id].tone}:${styles[id].length}`)}`,
      ).join("&"),
    [styles],
  );

  /** One base per mounted panel, so two Plan Story entries in a deck cannot
   *  mint the same `<label for>` target. The chapter id makes it per row. */
  const fieldIdBase = useId();

  const [rows, setRows] = useState<ChapterRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // What the advisor has typed but not yet saved, per chapter. Without it the
  // boxes cannot show freshly generated prose (an uncontrolled textarea keeps
  // its first value), and with a plain controlled value a reload mid-typing
  // would overwrite the words being written.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** The chapter with a write in flight, so a second click cannot double-write
   *  it. Every PATCH this guards files its own audit row, so a double click
   *  would double the record as well as the write. */
  const [saving, setSaving] = useState<string | null>(null);
  /** The chapter being rewritten, if any. Its own state rather than `saving`'s:
   *  a rewrite is a wait measured in tens of seconds, so the row it is happening
   *  to has to say so — and one at a time, since each is a model call. */
  const [regenerating, setRegenerating] = useState<string | null>(null);
  /**
   * A request that did not do what it said, AGAINST THE CHAPTER IT WAS ABOUT.
   * This panel is what certifies a human read every word, so a request that
   * failed silently is that promise failing quietly.
   *
   * Per chapter rather than one message for the panel: with fourteen rows an
   * advisor saves down the list, and a single message is cleared by the next
   * row's success — so "chapter 3's edit was never saved" disappears while
   * chapter 3's unsaved words sit in its box looking exactly like saved ones.
   */
  const [problems, setProblems] = useState<Record<string, string>>({});
  /** …and the two failures that really are about the whole panel. Kept apart so
   *  a row's failure and a failed load cannot overwrite each other. */
  const [panelProblem, setPanelProblem] = useState<string | null>(null);
  /**
   * A harvest that LANDED, against the chapter it was about. Its own map rather
   * than a value in `problems`: that map is read as a failure everywhere it is
   * rendered, and a success sharing it would inherit the alert styling, the
   * `role="alert"`, and every rule that clears it.
   */
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});
  /** The chapter being harvested, so a second click cannot store the passage
   *  twice. Each press writes a row and files an audit entry. */
  const [harvesting, setHarvesting] = useState<string | null>(null);
  /** Chapter ids the plan has moved underneath. See `CHAPTER_OUT_OF_DATE`. */
  const [outOfDate, setOutOfDate] = useState<Set<string>>(new Set());
  /**
   * The figures each chapter was allowed to use, keyed by chapter id — the
   * review panel's disclosure half of the same pack the model was shown.
   * Empty until `loadFacts` below answers.
   */
  const [facts, setFacts] = useState<Record<string, { label: string; display: string }[]>>({});
  /**
   * Has `loadFacts` actually answered — separate from `facts` itself because
   * "zero figures" and "no answer yet" both LOOK like an empty map, and they
   * are not the same claim: this is the one screen whose job is to tell the
   * advisor what a chapter was allowed to quote, so printing a count before
   * one is known would tell them "this chapter may use no figures" while the
   * real answer is still in flight — a wrong answer, not a missing one.
   */
  const [factsLoaded, setFactsLoaded] = useState(false);
  /**
   * Reading the story instead of editing it.
   *
   * PANEL-LOCAL on purpose, unlike the style: which view an advisor is looking
   * at changes nothing about the report, so there is nothing to persist and
   * nothing for an export to read.
   */
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/clients/${clientId}/plan-story?scenarioId=${encodeURIComponent(scenario)}` +
          `&documentRole=${encodeURIComponent(documentRole)}`,
      );
      if (!res.ok) throw new Error(`GET plan-story ${res.status}`);
      const body = (await res.json()) as { chapters: ChapterRow[] };
      setRows(body.chapters);
      setLoaded(true);
      // Clears the PANEL's message only. A row's own failure is cleared by that
      // row's next success — this reload runs after every one of them, and
      // clearing here is exactly how a failed save used to vanish behind a
      // different chapter's success.
      setPanelProblem(null);
    } catch (err) {
      // Caught rather than left to reject: a dropped connection here would
      // otherwise be an unhandled rejection over a panel showing nothing, no
      // reason, and a live Generate button.
      console.error("[plan-story] could not load chapters", err);
      setPanelProblem(COULD_NOT_LOAD);
    }
    // `documentRole` belongs here as much as the scenario does: since 0240 the
    // two presets store separate rows, so an advisor switching preset with the
    // panel open must re-read. Without it they would keep reading the previous
    // role's text under the new preset's heading.
  }, [clientId, scenario, documentRole]);

  /**
   * The expensive half, asked ONCE per story. A failure is logged and shows
   * nothing: the badge is advice about freshness, and a panel-level error about
   * a check the advisor never asked for would sit over a report whose chapters
   * are all readable and all saveable. It must not raise the alarm that means
   * "your chapters did not load".
   */
  const loadOutOfDate = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/clients/${clientId}/plan-story/stale?scenarioId=${encodeURIComponent(scenario)}` +
          `&documentRole=${encodeURIComponent(documentRole)}&${styleQuery}`,
      );
      if (!res.ok) throw new Error(`GET plan-story/stale ${res.status}`);
      const body = (await res.json()) as { stale: string[] };
      setOutOfDate(new Set(body.stale));
    } catch (err) {
      console.error("[plan-story] could not check which chapters are out of date", err);
    }
    // The STYLE is in here because it is an input to every chapter's stored
    // `sourceHash`: ask in the default voice about a chapter written in another
    // and the rebuilt hash matches nothing, so the row reads out of date with
    // nothing able to clear it.
  }, [clientId, scenario, documentRole, styleQuery]);

  /**
   * The disclosure half — which figures a chapter was allowed to use. Its own
   * request and its own state, for the same reason `loadOutOfDate` above is:
   * answering it costs a whole story context (`loadStoryRun`, 23.2s cold, 4.0s
   * warm), and the chapter list is reread after every save.
   *
   * ⚠️ NOT in `loadOutOfDate`'s dependency list, and deliberately not merged
   * with it. Facts come off `ctx.facts`, which reads plan projections, not the
   * advisor's tone and length — a style change has nothing to answer here, and
   * folding this in would spend a second twenty-second run on every tone
   * dropdown to find that out.
   *
   * A failure is logged rather than raising the panel-level alarm — the same
   * rule `loadOutOfDate` follows, since this is a disclosure, not a chapter,
   * and "your chapters did not load" would be the wrong message for it. It
   * does NOT set `factsLoaded`, so a row that never got an answer keeps
   * showing that rather than a synthesized zero.
   */
  const loadFacts = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/clients/${clientId}/plan-story/facts?scenarioId=${encodeURIComponent(scenario)}` +
          `&documentRole=${encodeURIComponent(documentRole)}`,
      );
      if (!res.ok) throw new Error(`GET plan-story/facts ${res.status}`);
      const body = (await res.json()) as {
        facts?: Record<string, { label: string; display: string }[]>;
      };
      // `?? {}`: a response that answered with 200 but not the expected shape
      // (an unrelated payload, a field the caller renamed) must not crash the
      // row it would have decorated — but it still counts as ANSWERED, so
      // `factsLoaded` is set either way. An actually empty pack and a
      // malformed-but-200 response are indistinguishable from here, and both
      // are closer to "disclose nothing" than to "keep the advisor waiting
      // forever" — unlike a thrown request below, which never reaches this
      // line and so never sets it.
      setFacts(body.facts ?? {});
      setFactsLoaded(true);
    } catch (err) {
      console.error("[plan-story] could not load the figures each chapter may use", err);
    }
  }, [clientId, scenario, documentRole]);

  // The story being SHOWN changed — a different client, scenario or preset. The
  // drafts belong to the story being left behind, so they go with it.
  useEffect(() => {
    setDrafts({});
    void load();
  }, [load]);

  /**
   * …and freshness, asked separately.
   *
   * ⚠️⚠️ SPLIT from the effect above, not merged back into it. This one also
   * re-runs when the STYLE moves, and the effect above clears the drafts — so
   * one effect covering both would wipe an advisor's unsaved typing every time
   * they touched a tone dropdown. The rows are not re-read here either: a style
   * change moves nothing the chapter list reports.
   */
  useEffect(() => {
    setOutOfDate(new Set());
    void loadOutOfDate();
  }, [loadOutOfDate]);

  // …and the facts disclosure, on the same mount-time rule as the badge above
  // but its own effect: `loadFacts` does not depend on the style, so a tone
  // change must not re-run it the way it re-runs `loadOutOfDate`. Reset
  // `factsLoaded` along with the map — the story being shown just changed, so
  // the previous story's answer is not one for this one.
  useEffect(() => {
    setFacts({});
    setFactsLoaded(false);
    void loadFacts();
  }, [loadFacts]);

  async function patch(
    chapterId: string,
    payload: Record<string, unknown>,
    failure: string,
  ) {
    setSaving(chapterId);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-story/${chapterId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario, documentRole, ...payload }),
      });
      // Refused: say so, against THIS chapter, and stop. Reloading here would
      // replace the advisor's words with the stored text and make a failed save
      // look like a saved one.
      if (!res.ok) {
        setProblems((p) => ({ ...p, [chapterId]: failure }));
        return;
      }
      setProblems((p) => without(p, chapterId));
      await load();
      // The stored row, not the keystrokes, is what prints — and the two are not
      // always the same string. Clearing the box is a real instruction ("drop my
      // version, print the model's words" — schemas/plan-story.ts), and the row
      // then resolves back to the generated text. Hand the box back to the
      // server once the write lands; keep the typed words when it didn't.
      setDrafts((d) => without(d, chapterId));
    } catch (err) {
      console.error("[plan-story] chapter write failed", chapterId, err);
      setProblems((p) => ({ ...p, [chapterId]: failure }));
    } finally {
      setSaving(null);
    }
  }

  /**
   * A chapter just written from the plan as it stands is fresh BY DEFINITION —
   * the run stored the hash of the plan it had in hand. So its badge comes down
   * WITHOUT asking the staleness route again, which would rebuild that identical
   * plan a second time (4s warm, 23s cold) on the end of a wait the advisor is
   * already sitting through.
   */
  function clearOutOfDate(chapterIds: string[]) {
    setOutOfDate((prev) => {
      const next = new Set(prev);
      for (const id of chapterIds) next.delete(id);
      return next;
    });
  }

  // Deliberately behind an explicit click: this is the only path in the app
  // that spends model calls, and the firm's ceiling is the only thing bounding
  // it — which is also why a failed run has to say so rather than reset the
  // button and invite another click.
  async function generateAll() {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-story/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // ⚠️ The style goes with a WHOLE RUN too, not just with a Regenerate.
        // This is the button an advisor presses first, and a run without it
        // writes all fourteen chapters in the default voice AND stores fourteen
        // default-voice hashes — so every restyled chapter then reads stale.
        body: JSON.stringify({ scenarioId: scenario, documentRole, chapterStyle: styles }),
      });
      if (!res.ok) {
        setPanelProblem(generationFailure(res, COULD_NOT_GENERATE));
        return;
      }
      setDrafts({});
      // Every row was just rewritten, so a save that failed before this run is
      // about words that no longer exist — the run discarded the drafts behind
      // them. A message left standing there would point at a box the advisor
      // can no longer act on.
      setProblems({});
      // Same argument, one step further: "Saved to your voice samples" names the
      // words that WERE in these boxes. The run replaced them, so the sentence
      // now sits over prose it is not about.
      setConfirmations({});
      // Only the chapters the run NAMES. One it skipped — nothing to recommend,
      // no data behind it — was not rewritten, so if it was out of date it
      // still is.
      const body = (await res.json().catch(() => null)) as { chapters?: { chapterId: string }[] } | null;
      clearOutOfDate((body?.chapters ?? []).map((c) => c.chapterId));
      await load();
    } catch (err) {
      console.error("[plan-story] generation request failed", err);
      setPanelProblem(COULD_NOT_GENERATE);
    } finally {
      setBusy(false);
    }
  }

  /**
   * One chapter, rewritten past the cache.
   *
   * `force` is what makes the button mean anything: the assistant's answers are
   * cached for 30 days and that entry cannot be deleted from any surface, so a
   * Regenerate that read the cache would return the very words the advisor
   * pressed it to replace.
   *
   * A failure is written against THIS row (Task 20's `problems`), never the
   * panel — the other thirteen chapters are untouched and still saveable, and a
   * panel-level alarm here reads as "your chapters did not load".
   */
  async function regenerate(chapterId: string) {
    setRegenerating(chapterId);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-story/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The whole map, not this row's entry alone: the route resolves what it
        // is sent and hashes the result, and one spelling of the style for both
        // buttons is what keeps the two from drifting apart.
        body: JSON.stringify({
          scenarioId: scenario,
          documentRole,
          chapterId,
          force: true,
          chapterStyle: styles,
        }),
      });
      if (!res.ok) {
        const message = generationFailure(res, COULD_NOT_REGENERATE);
        setProblems((p) => ({ ...p, [chapterId]: message }));
        return;
      }
      setProblems((p) => without(p, chapterId));
      // The words this chapter was being rewritten FROM are gone, so an unsaved
      // draft left in the box would shadow the new prose with the old — and the
      // box would stop showing what prints.
      setDrafts((d) => without(d, chapterId));
      // …and the harvest confirmation was about those same replaced words.
      setConfirmations((c) => without(c, chapterId));
      clearOutOfDate([chapterId]);
      await load();
    } catch (err) {
      console.error("[plan-story] chapter rewrite failed", chapterId, err);
      setProblems((p) => ({ ...p, [chapterId]: COULD_NOT_REGENERATE }));
    } finally {
      setRegenerating(null);
    }
  }

  /**
   * Keep this chapter's prose as an exemplar of how this advisor writes.
   *
   * Sends what is ON SCREEN — the unsaved draft when there is one — because
   * that is the text the advisor is looking at when they press it, and a button
   * that silently harvested the older stored version would store words they did
   * not choose.
   *
   * The route scrubs the household's names and every figure out on the way in
   * (`api/story-voice/samples/route.ts`), which is why `clientId` goes with it:
   * it names the household whose words have to come out.
   *
   * ⚠️ A refusal here is ORDINARY, not exceptional. A stored sample stops at
   * 2,000 characters and a chapter may hold 20,000, so the first long chapter
   * anyone presses this on comes back a 400 — `sampleRefusal` reads the server's
   * own issue list and names which bound was missed and by how much. A bare
   * failure would be a failure with no visible cause on the very first try.
   */
  async function harvest(chapterId: string, text: string) {
    setHarvesting(chapterId);
    try {
      const res = await fetch(`/api/story-voice/samples`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, sourceChapterId: chapterId, sourceClientId: clientId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setProblems((p) => ({ ...p, [chapterId]: sampleRefusal(body, text, COULD_NOT_HARVEST) }));
        return;
      }
      setProblems((p) => without(p, chapterId));
      setConfirmations((c) => ({ ...c, [chapterId]: HARVESTED }));
      // No `load()`, unlike every other write in this panel: this one changed
      // nothing the chapter list reports. The row landed in `story_voice_samples`
      // and the chapter's own stored text, edit flag and reviewed flag are all
      // untouched. A reload here would also clear `panelProblem` (see `load`),
      // and a failed chapter load is not something a harvest fixed.
    } catch (err) {
      console.error("[plan-story] voice-sample harvest failed", chapterId, err);
      setProblems((p) => ({ ...p, [chapterId]: COULD_NOT_HARVEST }));
    } finally {
      setHarvesting(null);
    }
  }

  const unreviewed = rows.filter((r) => !r.reviewed).length;

  /**
   * One row's two settings.
   *
   * On EVERY row, including the five proposal chapters a base-only story can
   * never rewrite — those have no Regenerate button, but they still print, and
   * the style is what decides how they read. Nothing here is disabled by a run
   * in flight either: changing a tone writes to the report's options, not to the
   * chapter, so it cannot collide with a generation.
   */
  function styleFields(chapterId: ChapterId) {
    const style = styles[chapterId];
    const toneId = `${fieldIdBase}-${chapterId}-tone`;
    const lengthId = `${fieldIdBase}-${chapterId}-length`;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          {/* A real `<label for>` rather than an `aria-label`, the rule the
              scenario picker already follows: it names the control to a screen
              reader and gives the caption a click target. Which CHAPTER it
              belongs to comes from the row's own region name. */}
          <label htmlFor={toneId} className={FIELD_CAPTION}>
            Tone
          </label>
          <select
            id={toneId}
            className={FIELD_SELECT}
            value={style.tone}
            onChange={(e) =>
              onChapterStyleChange(chapterId, { ...style, tone: e.target.value as ChapterTone })
            }
          >
            {CHAPTER_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {TONE_LABELS[tone]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor={lengthId} className={FIELD_CAPTION}>
            Length
          </label>
          <select
            id={lengthId}
            className={FIELD_SELECT}
            value={style.length}
            onChange={(e) =>
              onChapterStyleChange(chapterId, {
                ...style,
                length: e.target.value as ChapterLength,
              })
            }
          >
            {CHAPTER_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {LENGTH_LABELS[length]}
              </option>
            ))}
          </select>
        </div>

        {/* Only while `full` is actually picked — the canvas stays quiet for the
            advisor who is not using it, and the one who IS gets told rather than
            left to wonder why the prose came back identical. */}
        {style.length === "full" && chapterIgnoresFullLength(chapterId) && (
          <p className="text-xs text-ink-3">{FULL_IS_INERT}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {panelProblem != null && (
        <p role="alert" className="text-sm text-crit">
          {panelProblem}
        </p>
      )}

      <div className="flex items-center gap-3">
        {/* Rendered whether or not it has anything to say yet: a screen reader
            announces a change INSIDE a live region it already knows about, not
            the arrival of the region itself. The count changes under the
            advisor — a Generate run rewrites every row — so it has to speak. */}
        <p className="text-sm text-ink-3" aria-live="polite">
          {reviewSummary(loaded, unreviewed)}
        </p>
        {/* Beside Generate all, and carrying Generate all's own classes — it is
            the same kind of thing, a panel-wide action rather than a per-chapter
            one. Two differences, both deliberate: `ml-auto` moved here because
            this is now the first of the pair, and no `disabled:` rule, because
            nothing disables it. Reading is safe during a run and during a
            rewrite; both of those replace prose, and watching them land is a
            reason to be in this view rather than out of it.

            ⚠️⚠️ NO `aria-pressed`, and that is the opposite of what every other
            toggle in this repo does — `portal/transactions-list.tsx:302`
            ("Unreviewed"), `forms/ownership-editor.tsx:122` (a fixed `label` prop) and
            `portal/plaid-account-decision-row.tsx:237` ("Add as new") all hold one
            label and let the attribute carry the state. Those are filters and
            choices. This one REPLACES the panel body, so it changes its label
            instead — and you pick one or the other. Both together announce "Back
            to editing, toggle button, pressed", which states the pressed state
            against the action not yet taken. A test pins the absence. */}
        <button
          type="button"
          className="ml-auto rounded border border-hair px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
          onClick={() => setReading((r) => !r)}
        >
          {reading ? "Back to editing" : "Read it through"}
        </button>
        <button
          type="button"
          className="rounded border border-hair px-3 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
          onClick={() => void generateAll()}
          // …and not while one chapter is being rewritten: the run would write
          // over that chapter mid-rewrite, and both clicks are spend.
          disabled={busy || regenerating != null}
        >
          {busy ? "Writing…" : "Generate all"}
        </button>
      </div>

      {/* The whole story, end to end, in the order the report prints it —
          instead of fourteen edit boxes, not alongside them: two copies of every
          chapter would double a panel that already carries fourteen textareas,
          and a screen reader would meet each title twice.

          ⚠️ The ORDER is the report's; the MEMBERSHIP is this panel's. What
          prints is `printedChapters(options)` (`options-schema.ts`), which also
          drops every chapter the advisor switched off in `sections` — and this
          component is not given the options, deliberately. So an advisor who
          switched three chapters off reads a longer story here than the client
          gets. Do not "fix" that by taking an options prop: the print list is
          the renderer's to answer, and a second spelling of it here is rule 3 at
          the top of this file happening again.

          ⚠️ `row.text` is the STORED text, deliberately, not the draft in the
          box. This is what an advisor reads to decide the story hangs together,
          and what prints is what is stored — showing unsaved keystrokes here
          would certify words the export will never use.

          No words are lost either way. Clicking this toggle blurs the box the
          advisor was typing in, and that blur saves; a draft that somehow never
          was blurred is still in `drafts` and back in its box on the way out of
          this view.

          It applies none of the sheet's drop rules either, which is rule 3 at
          the top of this file: `splitParagraphs` splits and strips markdown and
          stops. A chapter can therefore read longer here than the one sheet it
          prints on — this view is not paginated, and that is the honest
          answer. */}
      {reading && (
        <article aria-label={WHOLE_STORY} className="flex flex-col gap-6 py-1">
          {rows.map((row) => {
            const paragraphs = splitParagraphs(row.text);
            return (
              <section key={row.chapterId} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-ink">{row.title}</h3>
                {paragraphs.length === 0 ? (
                  // `=== false`, never a falsy check — the field is optional, and
                  // a payload that does not answer must not be read as "nothing
                  // here can be written". Same rule as the Regenerate button's
                  // `!== false` below, from the other side.
                  <p className="text-xs text-ink-3">
                    {row.candidate === false ? NEEDS_A_PROPOSAL : NOTHING_TO_READ}
                  </p>
                ) : (
                  paragraphs.map((paragraph, i) => (
                    // Index keys: a paragraph has no identity of its own, and the
                    // whole list is rebuilt whenever the chapter's text changes.
                    <p key={i} className="max-w-prose text-sm leading-relaxed text-ink">
                      {paragraph}
                    </p>
                  ))
                )}
              </section>
            );
          })}
        </article>
      )}

      {!reading &&
        rows.map((row) => (
          // Named, so a message inside it is announced against the chapter it is
          // about rather than floating in the panel.
          <section
            key={row.chapterId}
            role="region"
            aria-label={row.title}
            className="rounded border border-hair p-3"
          >
            <header className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">{row.title}</h3>
              <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
                {statusLabel(row)}
              </span>
            </header>

            {problems[row.chapterId] != null && (
              <p role="alert" className="mb-2 text-sm text-crit">
                {problems[row.chapterId]}
              </p>
            )}

            {outOfDate.has(row.chapterId) && (
              <p className="mb-2 text-xs text-warn">{CHAPTER_OUT_OF_DATE}</p>
            )}

            {row.error != null && (
              <p className="mb-2 text-xs text-warn">{REASONS[row.error] ?? row.error}</p>
            )}

            {/* ⚠️⚠️ A rewrite the advisor's own words are standing in front of.
                Confirmed live: press Regenerate on a chapter you have edited and
                the new prose is stored and INVISIBLE — the same picture as this
                button failing, since its failure message is literally "The words
                on screen are unchanged".

                Three parts, all load-bearing. It SAYS what happened, so the
                advisor is not left comparing a silent success against a silent
                failure. It SHOWS the passage, because a click that discards
                their writing for prose they have not read is not a choice. And
                the swap is behind that explicit click: nothing in this feature
                overwrites an advisor's words without one that says so, which is
                also why the box above still holds their version and still
                prints it. */}
            {row.newerGeneratedText != null && (
              <div className="mb-2 rounded border border-hair bg-card-2 p-2">
                <p className="text-xs text-warn">
                  Your own words are showing. The assistant rewrote this chapter after you
                  edited it — the new version is stored but isn&apos;t what prints.
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-ink-3">
                  {row.newerGeneratedText}
                </p>
                <button
                  type="button"
                  className="mt-1 text-xs text-ink-3 underline hover:text-ink disabled:no-underline disabled:opacity-50"
                  // Dead while this row has a write in flight, on the same rule
                  // as Mark reviewed below: each press files its own audit row,
                  // and this one records advisor writing being thrown away.
                  disabled={saving === row.chapterId || regenerating === row.chapterId}
                  onClick={() =>
                    void patch(row.chapterId, { acceptGenerated: true }, COULD_NOT_ACCEPT)
                  }
                >
                  Use the new version instead
                </button>
              </div>
            )}

            <textarea
              className="min-h-28 w-full rounded border border-hair bg-card-2 p-2 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
              aria-label={`${row.title} text`}
              value={drafts[row.chapterId] ?? row.text}
              onChange={(e) => {
                setDrafts((d) => ({ ...d, [row.chapterId]: e.target.value }));
                // "Saved to your voice samples" named the words as they stood when
                // it was pressed. Once they change, the sentence is about a
                // passage that is no longer in the box.
                setConfirmations((c) => without(c, row.chapterId));
              }}
              onBlur={(e) => {
                if (e.target.value === row.text) return;
                void patch(row.chapterId, { editedText: e.target.value }, COULD_NOT_SAVE);
              }}
            />

            {/* Guarded, not assumed: `chapter_id` is free text in storage, so a
                row can outlive the chapter it names. There is no style to set for
                a chapter that has left the arc, and the rest of the row still
                works. */}
            {isChapterId(row.chapterId) && styleFields(row.chapterId)}

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                className="text-xs text-ink-3 underline hover:text-ink disabled:no-underline disabled:opacity-50"
                disabled={saving === row.chapterId || regenerating === row.chapterId}
                onClick={() => void patch(row.chapterId, { reviewed: true }, COULD_NOT_REVIEW)}
              >
                Mark reviewed
              </button>
              {/* One row's rewrite, past the 30-day cache. Disabled while ANY
                  chapter is being rewritten, and while a whole run is going: each
                  click is a model call the firm pays for, and the wait is long
                  enough that a second click is the natural thing to do.

                  Absent entirely — not greyed — on a row this story could never
                  write: the five proposal chapters of a base-only report. Nothing
                  the advisor can do makes it work, so a button whose only function
                  is to explain itself is not offered. The rest of the row stays
                  live: the box still takes their own words, and those still print. */}
              {row.candidate !== false && (
                <button
                  type="button"
                  className="text-xs text-ink-3 underline hover:text-ink disabled:no-underline disabled:opacity-50"
                  disabled={busy || regenerating != null || saving === row.chapterId}
                  onClick={() => void regenerate(row.chapterId)}
                >
                  {regenerating === row.chapterId ? "Rewriting…" : "Regenerate"}
                </button>
              )}
              {/* Only on a row the advisor has actually rewritten. A generated
                  chapter is the model's own prose, and keeping it as an exemplar
                  of how this advisor writes would teach the model to copy itself.
                  An EDITED one is the advisor's words, which is the whole point. */}
              {row.edited && (
                <button
                  type="button"
                  className="text-xs text-ink-3 underline hover:text-ink disabled:no-underline disabled:opacity-50"
                  // …and dead while a whole run or any rewrite is going, exactly as
                  // Regenerate above is. A harvest mid-"Generate all" stores the
                  // words the run is about to overwrite, and `generateAll` then
                  // clears the very confirmation that would have named them.
                  disabled={
                    busy ||
                    regenerating != null ||
                    saving === row.chapterId ||
                    harvesting === row.chapterId
                  }
                  onClick={() => void harvest(row.chapterId, drafts[row.chapterId] ?? row.text)}
                >
                  {harvesting === row.chapterId ? "Saving…" : "Save as a voice sample"}
                </button>
              )}
              {row.reviewed && (
                <>
                  <span className="text-xs text-good">Reviewed</span>
                  {/* The advisor's undo: `PATCH {reviewed:false}` — see
                      `clearChapterReviewed` (`story/repo.ts`). Before this, the
                      only way off a mis-click was Regenerate, which spends a
                      model call to answer a question that was never about the
                      words. */}
                  <button
                    type="button"
                    className="text-xs text-ink-3 underline hover:text-ink disabled:no-underline disabled:opacity-50"
                    disabled={saving === row.chapterId || regenerating === row.chapterId}
                    onClick={() =>
                      void patch(row.chapterId, { reviewed: false }, COULD_NOT_UNREVIEW)
                    }
                  >
                    Undo review
                  </button>
                </>
              )}
            </div>

            {confirmations[row.chapterId] != null && (
              <p role="status" className="mt-2 text-xs text-good">
                {confirmations[row.chapterId]}
              </p>
            )}

            {/* The disclosure half of the review: which figures this chapter
                was allowed to quote, from the same pack the model was shown
                (`factsForChapter`, `story/types.ts`). Collapsed by default —
                this is a reference an advisor checks, not something read on
                every pass down the list — and guarded by `isChapterId` for the
                same reason the style fields above are: a row can outlive the
                chapter it names, and there is nothing to disclose for one that
                has left the arc.

                The count reads "…" rather than "0" until `loadFacts` answers
                (`factsCount` above) — a wrong "0" would tell the advisor this
                chapter may use no figures, over the 4-23s `loadStoryRun`
                actually takes to answer, or permanently on a failed load. */}
            {isChapterId(row.chapterId) && (
              <details className="mt-2 text-xs text-ink-3">
                <summary className="cursor-pointer select-none hover:text-ink">
                  The figures this chapter may use (
                  {factsCount(factsLoaded, (facts[row.chapterId] ?? []).length)})
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                  {(facts[row.chapterId] ?? []).map((f, i) => (
                    // Index keys, the same choice the read-through view makes
                    // for its paragraphs: nothing here carries an id the panel
                    // was sent — `label` is not asserted unique — and the list
                    // is replaced whole on every `loadFacts`, never reordered
                    // in place.
                    <li key={i} className="list-disc">
                      {f.label}: {f.display}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
    </div>
  );
}
