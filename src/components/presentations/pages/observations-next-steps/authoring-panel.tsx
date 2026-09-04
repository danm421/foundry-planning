// Where the advisor assembles what the client reads on this page. Rows live
// on the household (`plan_observations`, audience = client) and print on
// every deck for this client; nothing here enters page options, so a deck
// saved as a firm template carries only the knobs above this panel.
//
// Rendered inside the page's options control behind a `clientId !== ""`
// guard (see options-control.tsx) — a component-library render of the
// control must never fire a fetch.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownMessage } from "@/components/forge/markdown-message";
import ObservationEditDialog, {
  type EditInitial,
} from "@/components/observations/observation-edit-dialog";
import type { ObservationItem } from "@/components/observations/observations-panel";
import { useScenarioOptions } from "@/components/presentations/options-context";
import { renderTokens } from "@/lib/plan-text/tokens";
import {
  visibleLibraryEntries,
  type ObservationLibraryEntry,
} from "@/lib/plan-text/observation-library";
import { OBSERVATION_TOPICS, TOPIC_LABELS, type ObservationTopic } from "@/lib/schemas/observations";
import { InsertFactMenu } from "./insert-fact-menu";
import { SuggestionCards } from "./suggestion-cards";
import { useDraftRun, type DraftSuggestion } from "./use-draft-run";

export type AuthoringRow = ObservationItem & {
  audience: "client" | "advisor";
  sourceScenarioId: string | null;
};

interface ObservationContext {
  observationsContext: string;
  nextStepsContext: string;
  nextStepsScenarioId: string | null;
}

interface Props {
  clientId: string;
  showObservations: boolean;
  showNextSteps: boolean;
}

const TOKEN_PATTERN = /\{\{[a-z0-9_]+\}\}/g;
const heading = "text-[12px] font-semibold uppercase tracking-wider text-ink-2";
const smallButton =
  "rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-hair disabled:hover:text-ink-2";
const textarea =
  "w-full resize-y rounded border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

/** One section's draft run, as `useDraftRun` hands it back. Module scope so
 *  `DraftCards` below can take one. */
type Draft = ReturnType<typeof useDraftRun>;

/** "…" per token while values load; the Details panel's convention. */
function renderBody(body: string, tokenValues: Record<string, string | null> | null): string {
  if (tokenValues === null) return body.replace(TOKEN_PATTERN, "…");
  return renderTokens(body, tokenValues);
}

export function ObservationsAuthoringPanel({ clientId, showObservations, showNextSteps }: Props) {
  const base = `/api/clients/${clientId}/observations`;
  const scenarios = useScenarioOptions();

  const [rows, setRows] = useState<AuthoringRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [context, setContext] = useState<ObservationContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextAttempt, setContextAttempt] = useState(0);
  const [tokenValues, setTokenValues] = useState<Record<string, string | null> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // One per section. A single shared state printed a next-steps failure
  // under the OBSERVATIONS box — the advisor was told the note they never
  // touched had failed to save.
  const [observationsNoteError, setObservationsNoteError] = useState<string | null>(null);
  const [nextStepsNoteError, setNextStepsNoteError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditInitial | null>(null);
  const onDialogSavedRef = useRef<(() => void) | null>(null);
  const obsDraft = useDraftRun(clientId);
  const stepDraft = useDraftRun(clientId);

  // Local copies of the two notes: the textarea is the advisor's, and a
  // failed save must not throw their words away.
  const [obsNotes, setObsNotes] = useState("");
  const [stepNotes, setStepNotes] = useState("");

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${base}?audience=client`, { cache: "no-store" });
      if (!res.ok) throw new Error("rows failed");
      setRows((await res.json()) as AuthoringRow[]);
      setRowsError(null);
    } catch {
      setRowsError("Couldn't load what's saved for this client.");
    }
  }, [base]);

  // Three independent loads. A failed token-values load leaves `null`, which
  // the library's hiding rule reads as "show everything" and the rows read as
  // "…" — never an empty menu presented as "nothing applies".
  useEffect(() => {
    refetch();
  }, [refetch]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/context`, { cache: "no-store" });
        if (!res.ok) throw new Error("context failed");
        const ctx = (await res.json()) as ObservationContext;
        if (cancelled) return;
        setContext(ctx);
        setContextError(null);
        setObsNotes(ctx.observationsContext);
        setStepNotes(ctx.nextStepsContext);
      } catch {
        // `context` stays null. The route answers 200 with defaults when no
        // row exists, so reaching here means a real failure — a note may be
        // stored that we could not read. Synthesising `{ ..., "" }` would
        // show an empty box and let the blur handler PATCH over a note the
        // advisor never saw; the blur guard's `!context` blocks that.
        if (!cancelled) setContextError("Couldn't load this client's notes.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, contextAttempt]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/token-values`, { cache: "no-store" });
        if (!res.ok) throw new Error("token-values failed");
        const { values } = (await res.json()) as { values: Record<string, string | null> };
        if (!cancelled) setTokenValues(values ?? {});
      } catch {
        // leave null — see above
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function postRow(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function patchContext(patch: Partial<ObservationContext>): Promise<boolean> {
    try {
      const res = await fetch(`${base}/context`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return false;
      setContext((await res.json()) as ObservationContext);
      return true;
    } catch {
      return false;
    }
  }

  async function insertFact(entry: ObservationLibraryEntry) {
    setSaveError(null);
    const ok = await postRow({
      section: "observation",
      source: "manual",
      audience: "client",
      topic: entry.topic,
      body: entry.body,
    });
    if (!ok) {
      setSaveError("Couldn't add that fact. Please try again.");
      return;
    }
    await refetch();
  }

  async function deleteRow(row: AuthoringRow) {
    setSaveError(null);
    try {
      const res = await fetch(`${base}/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSaveError("Couldn't delete this item. Please try again.");
      return;
    }
    await refetch();
  }

  /** Reorders within the topic group, then sends the whole client-audience
   *  observation order — the reorder route checks the list is complete. */
  async function moveObservation(id: string, dir: "up" | "down") {
    if (!rows) return;
    setSaveError(null);
    const byTopic = new Map<ObservationTopic, AuthoringRow[]>();
    for (const t of OBSERVATION_TOPICS) byTopic.set(t, []);
    for (const r of rows) if (r.section === "observation") byTopic.get(r.topic)!.push(r);
    const topic = OBSERVATION_TOPICS.find((t) => byTopic.get(t)!.some((r) => r.id === id));
    if (!topic) return;
    const group = byTopic.get(topic)!;
    const idx = group.findIndex((r) => r.id === id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= group.length) return;
    [group[idx], group[swap]] = [group[swap], group[idx]];
    const orderedIds = OBSERVATION_TOPICS.flatMap((t) => byTopic.get(t)!).map((r) => r.id);
    try {
      const res = await fetch(`${base}/reorder`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "observation", audience: "client", orderedIds }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSaveError("Couldn't save the new order.");
    }
    await refetch();
  }

  function openEdit(initial: EditInitial, onSaved?: () => void) {
    onDialogSavedRef.current = onSaved ?? null;
    setEditTarget(initial);
  }

  function suggestionBody(s: DraftSuggestion, scenarioId: string | null) {
    return {
      section: s.section,
      source: "ai",
      audience: "client",
      topic: s.topic,
      title: s.title,
      body: s.body,
      owner: s.owner,
      priority: s.priority,
      sourceScenarioId: scenarioId,
    };
  }

  async function acceptSuggestion(draft: Draft, idx: number) {
    const r = draft.result;
    if (!r) return;
    setSaveError(null);
    const s = r.suggestions[idx];
    draft.replaceSuggestions(r.suggestions.filter((_, i) => i !== idx));
    const ok = await postRow(suggestionBody(s, r.scenarioId));
    if (!ok) {
      draft.replaceSuggestions(r.suggestions);
      setSaveError("Couldn't accept this suggestion. Please try again.");
      return;
    }
    await refetch();
  }

  async function acceptAll(draft: Draft) {
    const r = draft.result;
    if (!r) return;
    setSaveError(null);
    const failed: DraftSuggestion[] = [];
    for (const s of r.suggestions) {
      if (!(await postRow(suggestionBody(s, r.scenarioId)))) failed.push(s);
    }
    draft.replaceSuggestions(failed);
    if (failed.length > 0) setSaveError(`Couldn't add ${failed.length} of them. Try again.`);
    await refetch();
  }

  function editAndAccept(draft: Draft, idx: number) {
    const r = draft.result;
    if (!r) return;
    const s = r.suggestions[idx];
    openEdit(
      {
        section: s.section,
        source: "ai",
        topic: s.topic,
        title: s.title,
        body: s.body,
        owner: s.owner,
        priority: s.priority,
        targetDate: null,
        sourceScenarioId: r.scenarioId,
      },
      () => draft.replaceSuggestions(r.suggestions.filter((_, i) => i !== idx)),
    );
  }

  const observationRows = useMemo(() => (rows ?? []).filter((r) => r.section === "observation"), [rows]);
  const nextStepRows = useMemo(() => (rows ?? []).filter((r) => r.section === "next_step"), [rows]);
  const libraryEntries = useMemo(() => visibleLibraryEntries(tokenValues), [tokenValues]);

  // Orphan integration-test scenarios (changes-writer.test.ts) pile up in the
  // picker; hide them as Retirement Comparison does. Base case has no edits
  // to turn into steps, so it is not offered either.
  const liveScenarios = scenarios.filter((s) => !s.isBaseCase && !s.name.startsWith("writer-test-"));
  const scenarioNameById = new Map(scenarios.map((s) => [s.id, s.name]));

  async function pickScenario(value: string) {
    setSaveError(null);
    const ok = await patchContext({ nextStepsScenarioId: value || null });
    if (!ok) setSaveError("Couldn't save the source scenario. Please try again.");
  }

  async function clearAiNextSteps() {
    if (!window.confirm("Remove every AI-generated next step for this client? Hand-written steps are kept.")) return;
    setSaveError(null);
    try {
      const res = await fetch(`${base}?section=next_step&source=ai`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSaveError("Couldn't clear the AI-generated steps. Please try again.");
      return;
    }
    stepDraft.clear();
    await refetch();
  }

  function provenance(row: AuthoringRow): React.ReactNode {
    if (row.source !== "ai" || !row.sourceScenarioId) return null;
    const name = scenarioNameById.get(row.sourceScenarioId);
    return name ? (
      <>From <em>{name}</em></>
    ) : (
      "From a scenario that has since been deleted"
    );
  }

  const hasAiSteps = nextStepRows.some((r) => r.source === "ai");
  const canGenerate = Boolean(context?.nextStepsScenarioId) && !stepDraft.drafting;

  return (
    <div className="space-y-6 text-sm text-ink-2">
      {saveError && (
        <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit">
          {saveError}
        </p>
      )}
      {rowsError && (
        <p role="alert" className="flex items-center gap-2 text-[13px] text-crit">
          {rowsError}
          <button type="button" className={smallButton} onClick={() => refetch()}>
            Retry
          </button>
        </p>
      )}
      {contextError && (
        <p role="alert" className="flex items-center gap-2 text-[13px] text-crit">
          {contextError}
          <button type="button" className={smallButton} onClick={() => setContextAttempt((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}

      {showObservations && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={heading}>Observations</h3>
            <div className="flex items-center gap-2">
              <InsertFactMenu entries={libraryEntries} tokenValues={tokenValues} onInsert={insertFact} />
              <button
                type="button"
                className={smallButton}
                disabled={obsDraft.drafting}
                onClick={() => obsDraft.start("observation")}
              >
                {obsDraft.drafting ? "Drafting…" : "Draft with AI"}
              </button>
            </div>
          </div>

          {rows !== null && observationRows.length === 0 && (
            <p className="text-[12px] text-ink-3">Nothing written yet — insert a fact or draft with AI.</p>
          )}
          {OBSERVATION_TOPICS.map((topic) => {
            const group = observationRows.filter((r) => r.topic === topic);
            if (group.length === 0) return null;
            return (
              <div key={topic} className="rounded-lg border border-hair bg-card p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  {TOPIC_LABELS[topic]}
                </div>
                <ul className="divide-y divide-hair">
                  {group.map((row, i) => (
                    <li key={row.id} className="group flex items-start gap-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <MarkdownMessage text={renderBody(row.body, tokenValues)} />
                      </div>
                      <RowActions
                        onEdit={() => openEdit(toEditInitial(row))}
                        onDelete={() => deleteRow(row)}
                        onUp={i > 0 ? () => moveObservation(row.id, "up") : undefined}
                        onDown={i < group.length - 1 ? () => moveObservation(row.id, "down") : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <DraftCards
            draft={obsDraft}
            tokenValues={tokenValues}
            onAccept={acceptSuggestion}
            onEditAccept={editAndAccept}
            onAcceptAll={acceptAll}
          />

          <NotesField
            label="Notes for the AI"
            placeholder="Anything the draft should know — concerns they raised, what you want emphasised, what to leave out."
            value={obsNotes}
            onChange={setObsNotes}
            onSave={async () => {
              if (!context || obsNotes === context.observationsContext) return;
              setObservationsNoteError(null);
              const ok = await patchContext({ observationsContext: obsNotes });
              if (!ok) setObservationsNoteError("Couldn't save your note");
            }}
          />
          {observationsNoteError && <p className="text-[12px] text-crit">{observationsNoteError}</p>}
        </section>
      )}

      {showNextSteps && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={heading}>Next steps</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={smallButton}
                disabled={!canGenerate}
                onClick={() => stepDraft.start("next_step")}
              >
                {stepDraft.drafting ? "Generating…" : "Generate from scenario"}
              </button>
              {hasAiSteps && (
                // Disabled mid-run: `clearAiNextSteps` calls `stepDraft.clear()`,
                // which cancels the poll and orphans a paid LLM run.
                <button
                  type="button"
                  className={`${smallButton} hover:border-crit hover:text-crit`}
                  disabled={stepDraft.drafting}
                  onClick={clearAiNextSteps}
                >
                  Clear AI-generated
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Source scenario</span>
              <select
                aria-label="Source scenario"
                className={`w-full ${textarea}`}
                value={context?.nextStepsScenarioId ?? ""}
                onChange={(e) => pickScenario(e.target.value)}
              >
                <option value="">— No scenario —</option>
                {liveScenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {!context?.nextStepsScenarioId && (
                <span className="text-[11px] text-ink-3">Pick a source scenario first — its edits become the steps.</span>
              )}
            </label>
            <div className="flex flex-col gap-1">
              <NotesField
                label="Notes for the AI"
                placeholder="What to stress, what to leave out, who should own what."
                value={stepNotes}
                onChange={setStepNotes}
                onSave={async () => {
                  if (!context || stepNotes === context.nextStepsContext) return;
                  setNextStepsNoteError(null);
                  const ok = await patchContext({ nextStepsContext: stepNotes });
                  if (!ok) setNextStepsNoteError("Couldn't save your note");
                }}
              />
              {nextStepsNoteError && <p className="text-[12px] text-crit">{nextStepsNoteError}</p>}
            </div>
          </div>

          <DraftCards
            draft={stepDraft}
            tokenValues={tokenValues}
            onAccept={acceptSuggestion}
            onEditAccept={editAndAccept}
            onAcceptAll={acceptAll}
          />

          {rows !== null && nextStepRows.length === 0 && (
            <p className="text-[12px] text-ink-3">No next steps yet — generate them from a scenario or add your own on Details.</p>
          )}
          <ul className="flex flex-col gap-2">
            {nextStepRows.map((row) => (
              <li key={row.id} className="group flex items-start gap-2 rounded-lg border border-hair bg-card p-3">
                <span
                  aria-label={`Status: ${row.status}`}
                  className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full border ${
                    row.status === "done" ? "border-accent bg-accent" : row.status === "in_progress" ? "border-accent" : "border-hair"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  {row.title && <p className="text-[13px] font-semibold text-ink">{row.title}</p>}
                  <MarkdownMessage text={renderBody(row.body, tokenValues)} />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-ink-3">
                    {row.owner && <span>{row.owner}</span>}
                    {row.priority && <span>{row.priority} priority</span>}
                    {row.targetDate && <span>Due {row.targetDate}</span>}
                  </div>
                  {provenance(row) && <p className="mt-1 text-[11px] normal-case text-ink-3">{provenance(row)}</p>}
                </div>
                <RowActions onEdit={() => openEdit(toEditInitial(row))} onDelete={() => deleteRow(row)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {editTarget && (
        <ObservationEditDialog
          key={editTarget.id ?? "new"}
          clientId={clientId}
          open
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            onDialogSavedRef.current?.();
            onDialogSavedRef.current = null;
            refetch();
          }}
        />
      )}
    </div>
  );
}

function toEditInitial(row: AuthoringRow): EditInitial {
  return {
    id: row.id,
    section: row.section,
    source: row.source,
    topic: row.topic,
    title: row.title,
    body: row.body,
    owner: row.owner,
    priority: row.priority,
    targetDate: row.targetDate,
  };
}

/** A run's error line and its suggestion cards. Both sections render one, so
 *  the accept handlers arrive as `(draft, idx)` and the closures are built
 *  here rather than twice at the call sites. */
function DraftCards({
  draft,
  tokenValues,
  onAccept,
  onEditAccept,
  onAcceptAll,
}: {
  draft: Draft;
  tokenValues: Record<string, string | null> | null;
  onAccept: (draft: Draft, idx: number) => void;
  onEditAccept: (draft: Draft, idx: number) => void;
  onAcceptAll: (draft: Draft) => void;
}) {
  const result = draft.result;
  return (
    <>
      {draft.error && <p role="alert" className="text-[12px] text-crit">{draft.error}</p>}
      {result && (
        <SuggestionCards
          suggestions={result.suggestions}
          tokenValues={tokenValues}
          onAccept={(i) => onAccept(draft, i)}
          onEditAccept={(i) => onEditAccept(draft, i)}
          onDismiss={(i) => draft.replaceSuggestions(result.suggestions.filter((_, k) => k !== i))}
          onAcceptAll={() => onAcceptAll(draft)}
        />
      )}
    </>
  );
}

/** The per-section "Notes for the AI" box. `onSave` fires on blur and owns its
 *  own dirty check — the two sections compare against different context
 *  fields. Module scope, so typing never remounts the textarea. */
function NotesField({
  label,
  placeholder,
  value,
  onChange,
  onSave,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <textarea
        className={textarea}
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
      />
    </label>
  );
}

function RowActions({
  onEdit,
  onDelete,
  onUp,
  onDown,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const btn = "rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-card-2 hover:text-accent";
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {onUp && <button type="button" aria-label="Move up" className={btn} onClick={onUp}>↑</button>}
      {onDown && <button type="button" aria-label="Move down" className={btn} onClick={onDown}>↓</button>}
      <button type="button" aria-label="Edit" className={btn} onClick={onEdit}>Edit</button>
      <button type="button" aria-label="Delete" className={`${btn} hover:text-crit`} onClick={onDelete}>Delete</button>
    </div>
  );
}
