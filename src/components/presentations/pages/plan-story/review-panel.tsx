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

function statusLabel(row: ChapterRow): string {
  if (!row.generated) return "Not generated yet";
  if (row.aiSuppressed) return "Written from plan figures";
  return row.edited ? "Edited" : "Generated";
}

export function PlanStoryReviewPanel({
  clientId,
  scenarioId,
}: {
  clientId: string;
  /** The options' scenario. Empty means a base-only story. */
  scenarioId: string;
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

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/clients/${clientId}/plan-story?scenarioId=${encodeURIComponent(scenario)}`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as { chapters: ChapterRow[] };
    setRows(body.chapters);
    setLoaded(true);
  }, [clientId, scenario]);

  // Runs on mount and whenever the client or scenario changes — the drafts
  // belong to the story being left behind, not to the one arriving.
  useEffect(() => {
    setDrafts({});
    void load();
  }, [load]);

  async function patch(chapterId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/clients/${clientId}/plan-story/${chapterId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: scenario, ...payload }),
    });
    await load();
    // The stored row, not the keystrokes, is what prints — and the two are not
    // always the same string. Clearing the box is a real instruction ("drop my
    // version, print the model's words" — schemas/plan-story.ts), and the row
    // then resolves back to the generated text. Hand the box back to the server
    // once the write lands; keep the typed words when it didn't, so a failed
    // save leaves something to retry rather than a silent revert.
    if (res.ok) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[chapterId];
        return next;
      });
    }
  }

  // Deliberately behind an explicit click: this is the only path in the app
  // that spends model calls, and it has no rate limit of its own.
  async function generateAll() {
    setBusy(true);
    try {
      await fetch(`/api/clients/${clientId}/plan-story/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario }),
      });
      setDrafts({});
      await load();
    } finally {
      setBusy(false);
    }
  }

  const unreviewed = rows.filter((r) => !r.reviewed).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {loaded && (
          <p className="text-sm text-ink-3">
            {unreviewed === 0
              ? "All chapters reviewed"
              : `${unreviewed} chapter${unreviewed === 1 ? "" : "s"} not yet reviewed`}
          </p>
        )}
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
        <section key={row.chapterId} className="rounded border border-hair p-3">
          <header className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">{row.title}</h3>
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
              {statusLabel(row)}
            </span>
          </header>

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
              void patch(row.chapterId, { editedText: e.target.value });
            }}
          />

          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-ink-3 underline hover:text-ink"
              onClick={() => void patch(row.chapterId, { reviewed: true })}
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
