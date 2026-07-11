"use client";

import { useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { RichTextEditor } from "@/components/rich-text-editor-dynamic";
import { listTokens } from "@/lib/plan-text/tokens";
import { OBSERVATION_TOPICS, TOPIC_LABELS, type ObservationTopic } from "@/lib/schemas/observations";

export type ObservationSection = "observation" | "next_step";
export type ObservationOwner = "advisor" | "client" | "joint";
export type ObservationPriority = "high" | "medium" | "low";
export type ObservationSource = "manual" | "ai";

/** Prefill for the dialog. `id` present → PATCH (edit); absent → POST (create).
 *  `source` rides on the create POST so AI-accepted items are tagged "ai". */
export interface EditInitial {
  id?: string;
  section: ObservationSection;
  source: ObservationSource;
  topic: ObservationTopic;
  title: string | null;
  body: string;
  owner: ObservationOwner | null;
  priority: ObservationPriority | null;
  targetDate: string | null;
}

const OWNER_LABELS: Record<ObservationOwner, string> = {
  advisor: "Advisor",
  client: "Client",
  joint: "Joint",
};

const PRIORITY_LABELS: Record<ObservationPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const CATEGORY_ORDER = ["People", "Plan", "Balance Sheet", "Cash Flow", "Analysis"] as const;

const SELECT_CLASS =
  "rounded border border-hair bg-card-2 px-2 py-1.5 text-[13px] text-ink-2 focus:border-accent focus:outline-none";
const FIELD_LABEL = "text-[11px] font-medium uppercase tracking-wider text-ink-3";

interface Props {
  clientId: string;
  open: boolean;
  initial: EditInitial;
  onClose: () => void;
  /** Called after a successful save (parent refetches + closes). */
  onSaved: () => void;
}

export default function ObservationEditDialog({ clientId, open, initial, onClose, onSaved }: Props) {
  const isNextStep = initial.section === "next_step";
  const isEdit = Boolean(initial.id);

  const [topic, setTopic] = useState<ObservationTopic>(initial.topic);
  const [title, setTitle] = useState(initial.title ?? "");
  const [body, setBody] = useState(initial.body);
  const [owner, setOwner] = useState<ObservationOwner | "">(initial.owner ?? "");
  const [priority, setPriority] = useState<ObservationPriority | "">(initial.priority ?? "");
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? "");
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenGroups = useMemo(() => {
    const tokens = listTokens();
    return CATEGORY_ORDER.map((category) => ({
      category,
      tokens: tokens.filter((t) => t.category === category),
    })).filter((g) => g.tokens.length > 0);
  }, []);

  function insertToken(id: string) {
    if (!id) return;
    // Append-only insertion — cursor-position insertion is future work.
    setBody((prev) => `${prev.replace(/\s+$/, "")} {{${id}}} `.replace(/^\s+/, ""));
  }

  async function handlePolish() {
    if (!body.trim() || polishing) return;
    setPolishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/observations/polish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === "string" ? j.error : "Couldn't polish this text.");
      }
      const { body: rewritten } = (await res.json()) as { body: string };
      setBody(rewritten);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't polish this text.");
    } finally {
      setPolishing(false);
    }
  }

  async function handleSave() {
    if (!body.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const base = `/api/clients/${clientId}/observations`;
      const normalizedTitle = title.trim() || null;
      const res = initial.id
        ? await fetch(`${base}/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              topic,
              title: normalizedTitle,
              body,
              owner: owner || null,
              priority: priority || null,
              targetDate: targetDate || null,
            }),
          })
        : await fetch(base, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              section: initial.section,
              source: initial.source,
              topic,
              title: normalizedTitle,
              body,
              owner: owner || null,
              priority: priority || null,
              targetDate: targetDate || null,
            }),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === "string" ? j.error : "Couldn't save.");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const heading = isNextStep ? "next step" : "observation";
  const title_ = isEdit ? `Edit ${heading}` : `New ${heading}`;

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title_}
      size="lg"
      primaryAction={{
        label: "Save",
        onClick: handleSave,
        disabled: !body.trim() || saving || polishing,
        loading: saving,
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Topic</span>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value as ObservationTopic)}
              className={SELECT_CLASS}
            >
              {OBSERVATION_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {TOPIC_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Insert data</span>
            <select
              value=""
              onChange={(e) => {
                insertToken(e.target.value);
                e.target.value = "";
              }}
              className={SELECT_CLASS}
              aria-label="Insert a live data value"
            >
              <option value="">Insert a value…</option>
              {tokenGroups.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.tokens.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        {isNextStep && (
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen"
              className="rounded border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
            />
          </label>
        )}

        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Details</span>
          <div className="overflow-hidden rounded border border-hair bg-card-2">
            <RichTextEditor value={body} onChange={setBody} placeholder="Write the details…" />
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-4">
              Live data values update automatically as the plan changes.
            </span>
            <button
              type="button"
              onClick={handlePolish}
              disabled={!body.trim() || polishing || saving}
              className="inline-flex items-center gap-1.5 rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3l1.9 4.8L18.7 9.7 13.9 11.6 12 16.4 10.1 11.6 5.3 9.7 10.1 7.8z" />
                <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
              </svg>
              {polishing ? "Polishing…" : "Polish with AI"}
            </button>
          </div>
        </div>

        {isNextStep && (
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Owner</span>
              <select
                value={owner}
                onChange={(e) => setOwner(e.target.value as ObservationOwner | "")}
                className={SELECT_CLASS}
              >
                <option value="">—</option>
                {(Object.keys(OWNER_LABELS) as ObservationOwner[]).map((o) => (
                  <option key={o} value={o}>
                    {OWNER_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Priority</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as ObservationPriority | "")}
                className={SELECT_CLASS}
              >
                <option value="">—</option>
                {(Object.keys(PRIORITY_LABELS) as ObservationPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Target date</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={`${SELECT_CLASS} tabular`}
              />
            </label>
          </div>
        )}

        {error && <p className="text-[13px] text-crit">{error}</p>}
      </div>
    </DialogShell>
  );
}
