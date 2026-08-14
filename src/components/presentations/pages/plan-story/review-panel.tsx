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
import { useCallback, useEffect, useState } from "react";

interface ChapterRow {
  chapterId: string;
  title: string;
  text: string;
  generated: boolean;
  edited: boolean;
  aiSuppressed: boolean;
  error: string | null;
  reviewed: boolean;
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
 * Asked for ONCE, on mount. The only other moment the answer moves is a
 * generation run, and that one is answered from the run's own response rather
 * than by asking again — see `generateAll`.
 */
const CHAPTER_OUT_OF_DATE =
  "The plan has changed since this chapter was written. Generate again to bring it up to date.";

/**
 * What `story/generate.ts` stores in `error`, and what the advisor is told it
 * means. The keys are that module's two frozen constants (generate.ts:28, :32).
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
const COULD_NOT_GENERATE =
  "Couldn't write the chapters. Nothing was generated — try again in a moment.";

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

export function PlanStoryReviewPanel({
  clientId,
  scenarioId,
  documentRole,
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
}) {
  // The routes want the literal "base" for a base-only story: their schema
  // requires a non-empty id (`schemas/plan-story.ts`) and
  // `resolveStoryScenarioId` maps a missing one to "base". The options spell
  // the same thing as "", so it is translated once, here.
  const scenario = scenarioId || "base";

  const [rows, setRows] = useState<ChapterRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // What the advisor has typed but not yet saved, per chapter. Without it the
  // boxes cannot show freshly generated prose (an uncontrolled textarea keeps
  // its first value), and with a plain controlled value a reload mid-typing
  // would overwrite the words being written.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** The chapter with a write in flight, so a second click cannot double-write
   *  it. Marking reviewed is not reversible from any surface, and every PATCH
   *  files its own audit row. */
  const [saving, setSaving] = useState<string | null>(null);
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
  /** Chapter ids the plan has moved underneath. See `CHAPTER_OUT_OF_DATE`. */
  const [outOfDate, setOutOfDate] = useState<Set<string>>(new Set());

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
          `&documentRole=${encodeURIComponent(documentRole)}`,
      );
      if (!res.ok) throw new Error(`GET plan-story/stale ${res.status}`);
      const body = (await res.json()) as { stale: string[] };
      setOutOfDate(new Set(body.stale));
    } catch (err) {
      console.error("[plan-story] could not check which chapters are out of date", err);
    }
  }, [clientId, scenario, documentRole]);

  // Runs on mount and whenever the client, scenario or preset changes — the
  // drafts, and which chapters are out of date, belong to the story being left
  // behind, not to the one arriving.
  useEffect(() => {
    setDrafts({});
    setOutOfDate(new Set());
    void load();
    void loadOutOfDate();
  }, [load, loadOutOfDate]);

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

  // Deliberately behind an explicit click: this is the only path in the app
  // that spends model calls, and it has no rate limit of its own — which is
  // also why a failed run has to say so rather than reset the button and
  // invite another click.
  async function generateAll() {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-story/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario, documentRole }),
      });
      if (!res.ok) {
        setPanelProblem(COULD_NOT_GENERATE);
        return;
      }
      setDrafts({});
      // Every row was just rewritten, so a save that failed before this run is
      // about words that no longer exist — the run discarded the drafts behind
      // them. A message left standing there would point at a box the advisor
      // can no longer act on.
      setProblems({});
      /**
       * The chapters the run wrote are fresh BY DEFINITION: it stored the hash
       * of the plan it had just read. So their badges come down from the
       * response, WITHOUT asking the staleness route again — that answer costs
       * a second full rebuild of a plan the generate route had in hand.
       *
       * Only the ones it names. A chapter the run skipped (nothing to
       * recommend, no data behind it) was not rewritten, so if it was out of
       * date it still is.
       */
      const body = (await res.json().catch(() => null)) as { chapters?: { chapterId: string }[] } | null;
      const rewritten = body?.chapters ?? [];
      setOutOfDate((prev) => {
        const next = new Set(prev);
        for (const c of rewritten) next.delete(c.chapterId);
        return next;
      });
      await load();
    } catch (err) {
      console.error("[plan-story] generation request failed", err);
      setPanelProblem(COULD_NOT_GENERATE);
    } finally {
      setBusy(false);
    }
  }

  const unreviewed = rows.filter((r) => !r.reviewed).length;

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
        <button
          type="button"
          className="ml-auto rounded border border-hair px-3 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
          onClick={() => void generateAll()}
          disabled={busy}
        >
          {busy ? "Writing…" : "Generate all"}
        </button>
      </div>

      {rows.map((row) => (
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

          <textarea
            className="min-h-28 w-full rounded border border-hair bg-card-2 p-2 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
            aria-label={`${row.title} text`}
            value={drafts[row.chapterId] ?? row.text}
            onChange={(e) =>
              setDrafts((d) => ({ ...d, [row.chapterId]: e.target.value }))
            }
            onBlur={(e) => {
              if (e.target.value === row.text) return;
              void patch(row.chapterId, { editedText: e.target.value }, COULD_NOT_SAVE);
            }}
          />

          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-ink-3 underline hover:text-ink disabled:no-underline disabled:opacity-50"
              disabled={saving === row.chapterId}
              onClick={() => void patch(row.chapterId, { reviewed: true }, COULD_NOT_REVIEW)}
            >
              Mark reviewed
            </button>
            {row.reviewed && <span className="text-xs text-good">Reviewed</span>}
          </div>
        </section>
      ))}
    </div>
  );
}
