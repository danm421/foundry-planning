"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "@/components/forge/markdown-message";
import { renderTokens } from "@/lib/plan-text/tokens";
import { OBSERVATION_TOPICS } from "@/lib/schemas/observations";
import ObservationEditDialog, {
  TOPIC_LABELS,
  type EditInitial,
  type ObservationOwner,
  type ObservationPriority,
  type ObservationSection,
  type ObservationSource,
  type ObservationTopic,
} from "./observation-edit-dialog";

type ObservationStatus = "open" | "in_progress" | "done";

export interface ObservationItem {
  id: string;
  section: ObservationSection;
  topic: ObservationTopic;
  title: string | null;
  body: string;
  status: ObservationStatus;
  owner: ObservationOwner | null;
  priority: ObservationPriority | null;
  targetDate: string | null;
  source: ObservationSource;
  sortOrder: number;
}

/** AI draft shape — mirrors ObservationSuggestionSchema (no targetDate). */
interface Suggestion {
  section: ObservationSection;
  topic: ObservationTopic;
  title: string | null;
  body: string;
  owner: ObservationOwner | null;
  priority: ObservationPriority | null;
}

interface Props {
  clientId: string;
  initialItems: ObservationItem[];
}

const RUN_POLL_MS = 3000;
const RUN_POLL_MAX_FAILURES = 10; // ~30s of a dead endpoint before we bail.
const TOKEN_PATTERN = /\{\{[a-z0-9_]+\}\}/g;

const STATUS_LABEL: Record<ObservationStatus, string> = {
  open: "To do",
  in_progress: "In progress",
  done: "Done",
};
const STATUS_CYCLE: Record<ObservationStatus, ObservationStatus> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
};
const OWNER_LABELS: Record<ObservationOwner, string> = {
  advisor: "Advisor",
  client: "Client",
  joint: "Joint",
};
const PRIORITY_LABELS: Record<ObservationPriority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

/** Token render: while values are still loading (null) show an ellipsis so the
 *  advisor doesn't see raw `{{token}}`; once loaded, substitute plain values. */
function renderBody(body: string, tokenValues: Record<string, string | null> | null): string {
  if (tokenValues === null) return body.replace(TOKEN_PATTERN, "…");
  return renderTokens(body, tokenValues);
}

export default function ObservationsPanel({ clientId, initialItems }: Props) {
  const [items, setItems] = useState<ObservationItem[]>(initialItems);
  const [tokenValues, setTokenValues] = useState<Record<string, string | null> | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [editTarget, setEditTarget] = useState<EditInitial | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  // Index of the suggestion being edited-and-accepted, so a save clears it.
  const editingSuggestionIdx = useRef<number | null>(null);

  const base = `/api/clients/${clientId}/observations`;

  // Returns whether the resync actually landed, so mutation-failure paths that
  // depend on refetch() to reflect server truth can tell the user when it
  // didn't (instead of leaving a stale screen with no signal).
  const refetch = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return false;
      const rows = (await res.json()) as ObservationItem[];
      setItems(rows);
      return true;
    } catch {
      return false;
    }
  }, [base]);

  // Load live token values once on mount. On failure fall back to an empty map
  // so tokens resolve to "—" (renderTokens' own fallback) instead of spinning.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/token-values`, { cache: "no-store" });
        if (!res.ok) throw new Error("token-values failed");
        const { values } = (await res.json()) as { values: Record<string, string | null> };
        if (!cancelled) setTokenValues(values ?? {});
      } catch {
        if (!cancelled) setTokenValues({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  // Poll the active draft run until it settles (mirrors meeting-prep-wizard).
  // The run lives server-side, so leaving the page doesn't kill it.
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const retryOrBail = () => {
      failures += 1;
      if (failures >= RUN_POLL_MAX_FAILURES) {
        setActiveRunId(null);
        setDraftError("Couldn't check on the draft. Please try again.");
        return;
      }
      timer = setTimeout(tick, RUN_POLL_MS);
    };

    const tick = async () => {
      try {
        const res = await fetch(`${base}/draft-runs/${activeRunId}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          retryOrBail();
          return;
        }
        const run = (await res.json()) as {
          status: string;
          error: string | null;
          suggestions: Suggestion[] | null;
        };
        failures = 0;
        if (run.status === "done") {
          setActiveRunId(null);
          setSuggestions(run.suggestions ?? []);
          return;
        }
        if (run.status === "failed") {
          setActiveRunId(null);
          setDraftError(run.error ?? "The AI draft didn't finish. Please try again.");
          return;
        }
        timer = setTimeout(tick, RUN_POLL_MS); // still in flight
      } catch {
        if (!cancelled) retryOrBail();
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeRunId, base]);

  async function startDraft() {
    if (activeRunId) return;
    setDraftError(null);
    try {
      const res = await fetch(`${base}/draft-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === "string" ? j.error : "Couldn't start the draft.");
      }
      const { runId } = (await res.json()) as { runId: string };
      setActiveRunId(runId);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Couldn't start the draft.");
    }
  }

  async function quickAdd(section: ObservationSection, text: string) {
    const body = text.trim();
    if (!body) return;
    const payload =
      section === "next_step" ? { section, title: body, body } : { section, body };
    // Optimistic append with a temp row; refetch reconciles ids/sortOrder.
    const temp: ObservationItem = {
      id: `temp-${Date.now()}`,
      section,
      topic: "general",
      title: section === "next_step" ? body : null,
      body,
      status: "open",
      owner: null,
      priority: null,
      targetDate: null,
      source: "manual",
      sortOrder: Number.MAX_SAFE_INTEGER,
    };
    setItems((prev) => [...prev, temp]);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("create failed");
    } catch {
      setItems((prev) => prev.filter((i) => i.id !== temp.id));
      return;
    }
    refetch();
  }

  async function cycleStatus(item: ObservationItem) {
    setDraftError(null);
    const next = STATUS_CYCLE[item.status];
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)));
    try {
      const res = await fetch(`${base}/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("update failed");
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
      setDraftError("Couldn't update the status. Please try again.");
      return;
    }
    refetch();
  }

  async function deleteItem(item: ObservationItem) {
    setDraftError(null);
    const prevItems = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const res = await fetch(`${base}/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setItems(prevItems);
      setDraftError("Couldn't delete this item. Please try again.");
      return;
    }
    refetch();
  }

  async function moveObservation(id: string, dir: "up" | "down") {
    setDraftError(null);
    const byTopic = new Map<ObservationTopic, ObservationItem[]>();
    for (const t of OBSERVATION_TOPICS) byTopic.set(t, []);
    for (const it of items) if (it.section === "observation") byTopic.get(it.topic)!.push(it);

    const topic = OBSERVATION_TOPICS.find((t) => byTopic.get(t)!.some((i) => i.id === id));
    if (!topic) return;
    const arr = byTopic.get(topic)!;
    const idx = arr.findIndex((i) => i.id === id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];

    const newObs = OBSERVATION_TOPICS.flatMap((t) => byTopic.get(t)!);
    const orderedIds = newObs.map((i) => i.id);
    setItems([...newObs, ...items.filter((i) => i.section === "next_step")]);
    try {
      const res = await fetch(`${base}/reorder`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "observation", orderedIds }),
      });
      if (!res.ok) throw new Error("reorder failed");
    } catch {
      // We don't know the true order after a rejected reorder (e.g. a stale-order
      // race with another editor), so resync from the server rather than guess.
      const synced = await refetch();
      setDraftError(
        synced
          ? "Couldn't save the new order — it's been reset to match the server."
          : "Couldn't save the new order, and the screen may be out of date. Please refresh.",
      );
      return;
    }
    refetch();
  }

  async function acceptSuggestion(s: Suggestion, idx: number) {
    setDraftError(null);
    setSuggestions((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section: s.section,
          source: "ai",
          topic: s.topic,
          title: s.title,
          body: s.body,
          owner: s.owner,
          priority: s.priority,
        }),
      });
      if (!res.ok) throw new Error("accept failed");
    } catch {
      setSuggestions((prev) => {
        const next = prev ? [...prev] : [];
        next.splice(idx, 0, s);
        return next;
      });
      setDraftError("Couldn't accept this suggestion. Please try again.");
      return;
    }
    refetch();
  }

  function editSuggestion(s: Suggestion, idx: number) {
    editingSuggestionIdx.current = idx;
    setEditTarget({
      section: s.section,
      source: "ai",
      topic: s.topic,
      title: s.title,
      body: s.body,
      owner: s.owner,
      priority: s.priority,
      targetDate: null,
    });
  }

  function dismissSuggestion(idx: number) {
    setSuggestions((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
  }

  function onDialogSaved() {
    if (editingSuggestionIdx.current !== null) {
      const idx = editingSuggestionIdx.current;
      setSuggestions((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
      editingSuggestionIdx.current = null;
    }
    setEditTarget(null);
    refetch();
  }

  function closeDialog() {
    editingSuggestionIdx.current = null;
    setEditTarget(null);
  }

  const observationItems = items.filter((i) => i.section === "observation");
  const nextSteps = items.filter((i) => i.section === "next_step");
  const activeNextSteps = nextSteps.filter((i) => i.status !== "done");
  const completedNextSteps = nextSteps.filter((i) => i.status === "done");
  const isEmpty = items.length === 0;
  const drafting = activeRunId !== null;
  const activeSuggestions = suggestions ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Observations &amp; Next Steps
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            The narrative and action list for this plan. Live data values stay current as the
            plan changes.
          </p>
        </div>
        <button
          type="button"
          onClick={startDraft}
          disabled={drafting}
          className="btn-primary text-[13px] disabled:opacity-60"
        >
          {drafting ? "Drafting…" : "Draft with AI"}
        </button>
      </header>

      {draftError && (
        <p className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit">
          {draftError}
        </p>
      )}

      {activeSuggestions.length > 0 && (
        <section className="rounded-xl border border-accent/40 bg-accent-wash p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="chip chip-accent">AI draft</span>
            <span className="text-[12px] text-ink-3">
              {activeSuggestions.length} suggestion{activeSuggestions.length === 1 ? "" : "s"} —
              review before adding
            </span>
          </div>
          <ul className="flex flex-col gap-3">
            {activeSuggestions.map((s, idx) => (
              <li key={idx} className="rounded-lg border border-hair bg-card p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <MetaBadge>{TOPIC_LABELS[s.topic]}</MetaBadge>
                  <MetaBadge>{s.section === "next_step" ? "Next step" : "Observation"}</MetaBadge>
                </div>
                {s.title && <p className="mb-1 text-[14px] font-semibold text-ink">{s.title}</p>}
                <MarkdownMessage text={renderBody(s.body, tokenValues)} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => acceptSuggestion(s, idx)}
                    className="rounded border border-accent bg-accent/10 px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent/20"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => editSuggestion(s, idx)}
                    className="rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-accent"
                  >
                    Edit &amp; accept
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissSuggestion(idx)}
                    className="rounded px-2.5 py-1 text-[12px] font-medium text-ink-3 hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isEmpty && (
        <div className="rounded-xl border border-hair bg-card p-6 text-center">
          <p className="text-[15px] font-medium text-ink">No observations yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-3">
            Draft a starting set from this plan&apos;s numbers, then edit to taste — or add your own
            below.
          </p>
          <button
            type="button"
            onClick={startDraft}
            disabled={drafting}
            className="btn-primary mt-4 text-[13px] disabled:opacity-60"
          >
            {drafting ? "Drafting…" : "Draft with AI"}
          </button>
        </div>
      )}

      {/* Observations */}
      <section className="flex flex-col gap-3">
        <SectionHeading>Observations</SectionHeading>
        {observationItems.length > 0 &&
          OBSERVATION_TOPICS.map((topic) => {
            const group = observationItems.filter((i) => i.topic === topic);
            if (group.length === 0) return null;
            return (
              <div key={topic} className="rounded-xl border border-hair bg-card p-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  {TOPIC_LABELS[topic]}
                </h3>
                <ul className="flex flex-col divide-y divide-hair">
                  {group.map((item, i) => (
                    <li key={item.id} className="group flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-4" />
                      <div className="min-w-0 flex-1">
                        <MarkdownMessage text={renderBody(item.body, tokenValues)} />
                      </div>
                      <RowActions
                        onEdit={() => setEditTarget(toEditInitial(item))}
                        onDelete={() => deleteItem(item)}
                        onUp={i > 0 ? () => moveObservation(item.id, "up") : undefined}
                        onDown={i < group.length - 1 ? () => moveObservation(item.id, "down") : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        <QuickAdd
          placeholder="Add an observation…"
          onSubmit={(text) => quickAdd("observation", text)}
        />
      </section>

      {/* Next steps */}
      <section className="flex flex-col gap-3">
        <SectionHeading>Next Steps</SectionHeading>
        {activeNextSteps.length > 0 && (
          <ul className="flex flex-col gap-2">
            {activeNextSteps.map((item) => (
              <NextStepRow
                key={item.id}
                item={item}
                tokenValues={tokenValues}
                onCycle={() => cycleStatus(item)}
                onEdit={() => setEditTarget(toEditInitial(item))}
                onDelete={() => deleteItem(item)}
              />
            ))}
          </ul>
        )}
        <QuickAdd placeholder="Add a next step…" onSubmit={(text) => quickAdd("next_step", text)} />

        {completedNextSteps.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 hover:text-ink-2"
            >
              <span aria-hidden className={`transition-transform ${showCompleted ? "rotate-90" : ""}`}>
                ›
              </span>
              Completed ({completedNextSteps.length})
            </button>
            {showCompleted && (
              <ul className="mt-2 flex flex-col gap-2">
                {completedNextSteps.map((item) => (
                  <NextStepRow
                    key={item.id}
                    item={item}
                    tokenValues={tokenValues}
                    onCycle={() => cycleStatus(item)}
                    onEdit={() => setEditTarget(toEditInitial(item))}
                    onDelete={() => deleteItem(item)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {editTarget && (
        <ObservationEditDialog
          key={editTarget.id ?? "new"}
          clientId={clientId}
          open
          initial={editTarget}
          onClose={closeDialog}
          onSaved={onDialogSaved}
        />
      )}
    </div>
  );
}

function toEditInitial(item: ObservationItem): EditInitial {
  return {
    id: item.id,
    section: item.section,
    source: item.source,
    topic: item.topic,
    title: item.title,
    body: item.body,
    owner: item.owner,
    priority: item.priority,
    targetDate: item.targetDate,
  };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-2">{children}</h2>
  );
}

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-hair px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-3">
      {children}
    </span>
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
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {onUp !== undefined && (
        <IconButton label="Move up" onClick={onUp}>
          <path d="M6 15l6-6 6 6" />
        </IconButton>
      )}
      {onDown !== undefined && (
        <IconButton label="Move down" onClick={onDown}>
          <path d="M6 9l6 6 6-6" />
        </IconButton>
      )}
      <IconButton label="Edit" onClick={onEdit}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
      </IconButton>
      <IconButton label="Delete" onClick={onDelete} danger>
        <path d="M3 6h18" />
        <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
        <path d="M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6" />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-card-2 ${
        danger ? "hover:text-crit" : "hover:text-accent"
      }`}
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function NextStepRow({
  item,
  tokenValues,
  onCycle,
  onEdit,
  onDelete,
}: {
  item: ObservationItem;
  tokenValues: Record<string, string | null> | null;
  onCycle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const done = item.status === "done";
  return (
    <li className="group flex items-start gap-3 rounded-xl border border-hair bg-card p-3">
      <StatusButton status={item.status} onClick={onCycle} />
      <div className="min-w-0 flex-1">
        {item.title && (
          <p className={`text-[14px] font-semibold ${done ? "text-ink-3 line-through" : "text-ink"}`}>
            {item.title}
          </p>
        )}
        <div className={done ? "opacity-60" : ""}>
          <MarkdownMessage text={renderBody(item.body, tokenValues)} />
        </div>
        {(item.owner || item.priority || item.targetDate) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.owner && <MetaBadge>{OWNER_LABELS[item.owner]}</MetaBadge>}
            {item.priority && <MetaBadge>{PRIORITY_LABELS[item.priority]}</MetaBadge>}
            {item.targetDate && (
              <span className="inline-flex items-center rounded-full border border-hair px-2 py-0.5 text-[10px] text-ink-3">
                Due <span className="tabular ml-1">{item.targetDate}</span>
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <IconButton label="Edit" onClick={onEdit}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </IconButton>
        <IconButton label="Delete" onClick={onDelete} danger>
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
          <path d="M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6" />
        </IconButton>
      </div>
    </li>
  );
}

function StatusButton({ status, onClick }: { status: ObservationStatus; onClick: () => void }) {
  const label = STATUS_LABEL[status];
  const ring =
    status === "done"
      ? "border-accent bg-accent text-accent-on"
      : status === "in_progress"
        ? "border-accent text-accent"
        : "border-hair text-ink-4";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Status: ${label}. Click to advance.`}
      title={`Status: ${label}. Click to advance.`}
      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${ring} transition-colors`}
    >
      {status === "done" ? (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 13l4 4L19 7" />
        </svg>
      ) : status === "in_progress" ? (
        <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function QuickAdd({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          e.preventDefault();
          onSubmit(value);
          setValue("");
        }
      }}
      className="w-full rounded-lg border border-dashed border-hair bg-transparent px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
    />
  );
}
