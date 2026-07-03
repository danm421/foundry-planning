"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircleIcon } from "@/components/icons";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import {
  inputClassName,
  inputBaseClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import {
  MEETING_PREP_DOC_KINDS,
  type MeetingPrepDocKind,
  type MeetingPrepSetup,
  type PrepBriefDraft,
  type AgendaDraft,
} from "@/lib/crm/meeting-prep/schemas";
import type { MeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";

type WizardStep = "setup" | "generating" | "review";
type Draft = { brief: PrepBriefDraft | null; agenda: AgendaDraft | null };

interface Props {
  householdId: string;
  householdName: string;
  hasPlanningClient: boolean;
}

const DOC_LABELS: Record<MeetingPrepDocKind, string> = {
  brief: "Prep Brief (internal)",
  agenda: "Client Agenda (client-facing)",
};

const RUN_POLL_MS = 3000;
// Consecutive failed status checks (non-2xx or network error) before we stop
// polling and surface an error — ~30s of a dead endpoint.
const RUN_POLL_MAX_FAILURES = 10;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function draftStorageKey(householdId: string): string {
  return `meeting-prep-draft:${householdId}`;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const BRIEF_LIST_SECTIONS: Array<{ key: keyof PrepBriefDraft; label: string }> = [
  { key: "sinceLastMeeting", label: "Since last meeting" },
  { key: "talkingPoints", label: "Talking points" },
  { key: "openQuestions", label: "Open questions" },
  { key: "personalNotes", label: "Personal notes" },
];

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MeetingPrepWizard({
  householdId,
  householdName,
  hasPlanningClient,
}: Props) {
  const [step, setStep] = useState<WizardStep>("setup");
  const [focus, setFocus] = useState("");
  const [context, setContext] = useState("");
  const [meetingDate, setMeetingDate] = useState(today);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [docs, setDocs] = useState<MeetingPrepDocKind[]>([...MEETING_PREP_DOC_KINDS]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [data, setData] = useState<MeetingPrepBattery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MeetingPrepDocKind>("brief");
  const [exporting, setExporting] = useState<MeetingPrepDocKind | null>(null);
  const [exported, setExported] = useState<MeetingPrepDocKind[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [restoredBanner, setRestoredBanner] = useState(false);

  // Restore any unsaved draft AFTER mount (never during render/SSR — no
  // localStorage on the server, and a synchronous read would hydration-mismatch).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(draftStorageKey(householdId));
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        setup?: MeetingPrepSetup;
        draft?: Draft;
        data?: MeetingPrepBattery;
      };
      if (!saved.setup || !saved.draft) return;
      setFocus(saved.setup.focus ?? "");
      setContext(saved.setup.context ?? "");
      setMeetingDate(saved.setup.meetingDate ?? today());
      setWindowStart(saved.setup.windowStart ?? null);
      if (Array.isArray(saved.setup.docs) && saved.setup.docs.length > 0) {
        setDocs(saved.setup.docs);
      }
      setDraft(saved.draft);
      setData(saved.data ?? null);
      setActiveTab(saved.draft.brief ? "brief" : "agenda");
      setStep("review");
      setRestoredBanner(true);
    } catch {
      // Corrupt payload — ignore and start fresh.
    }
  }, [householdId]);

  const setup: MeetingPrepSetup = {
    focus,
    context,
    meetingDate,
    windowStart,
    docs,
  };

  // Persist the in-progress review so a reload/navigation doesn't lose the
  // advisor's edits. Only meaningful once a draft exists (review step).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (step !== "review" || !draft) return;
    try {
      window.localStorage.setItem(
        draftStorageKey(householdId),
        JSON.stringify({ setup, draft, data }),
      );
    } catch {
      // Storage full/blocked — non-fatal; drafts just won't survive reload.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draft, data, focus, context, meetingDate, windowStart, docs, householdId]);

  function toggleDoc(kind: MeetingPrepDocKind) {
    setDocs((prev) =>
      prev.includes(kind) ? prev.filter((d) => d !== kind) : [...prev, kind],
    );
  }

  const canGenerate = focus.trim().length > 0 && docs.length > 0;

  function applyRunResult(payload: { draft: Draft; data: MeetingPrepBattery | null }) {
    setDraft(payload.draft);
    setData(payload.data ?? null);
    setExported([]);
    setExportError(null);
    setActiveTab(
      docs.find((d) => payload.draft[d]) ?? (payload.draft.brief ? "brief" : "agenda"),
    );
    setStep("review");
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    setStep("generating");
    setError(null);
    try {
      const res = await fetch(`/api/crm/households/${householdId}/meeting-prep/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(setup),
      });
      if (res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j?.error === "string" ? j.error : `Draft failed (${res.status})`,
        );
      }
      const { runId } = (await res.json()) as { runId: string };
      setActiveRunId(runId); // polling effect takes over
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep("setup");
    }
  }

  // Poll the active run until it settles. The run lives server-side — leaving
  // this page doesn't kill it; Recent runs picks it up on return.
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const bail = (message: string) => {
      setActiveRunId(null);
      setError(message);
      setStep("setup");
    };
    // Non-ok response or network error — retry until the cap, then give up
    // (session expiry / 404 / outage would otherwise spin forever).
    const retryOrBail = () => {
      failures += 1;
      if (failures >= RUN_POLL_MAX_FAILURES) {
        bail("Couldn't check on the draft. Please try again.");
        return;
      }
      timer = setTimeout(tick, RUN_POLL_MS);
    };
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/crm/households/${householdId}/meeting-prep/runs/${activeRunId}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.ok) {
          failures = 0;
          const { run } = (await res.json()) as {
            run: {
              status: string;
              error: string | null;
              resultPayload: { draft: Draft; data: MeetingPrepBattery | null } | null;
            };
          };
          if (run.status === "done") {
            setActiveRunId(null);
            if (run.resultPayload) {
              applyRunResult(run.resultPayload);
            } else {
              // Terminal but empty — the stale sweep never rescues done rows,
              // so polling on would never end.
              setError("Something went wrong.");
              setStep("setup");
            }
            return;
          }
          if (run.status === "failed") {
            setActiveRunId(null);
            setError(run.error ?? "Something went wrong.");
            setStep("setup");
            return;
          }
          // still in flight — poll again (stale sweep server-side guarantees
          // in-flight runs terminate)
          timer = setTimeout(tick, RUN_POLL_MS);
          return;
        }
        retryOrBail();
      } catch {
        if (!cancelled) retryOrBail(); // transient network blip
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, householdId]);

  function updateBrief(patch: Partial<PrepBriefDraft>) {
    setDraft((prev) =>
      prev?.brief ? { ...prev, brief: { ...prev.brief, ...patch } } : prev,
    );
  }

  function updateAgendaItems(agendaItems: AgendaDraft["agendaItems"]) {
    setDraft((prev) => (prev?.agenda ? { ...prev, agenda: { agendaItems } } : prev));
  }

  async function handleExport(kind: MeetingPrepDocKind) {
    if (!draft) return;
    setExporting(kind);
    setExportError(null);
    try {
      const payload =
        kind === "brief"
          ? { doc: "brief" as const, setup, brief: draft.brief }
          : { doc: "agenda" as const, setup, agenda: draft.agenda };
      const res = await fetch(`/api/crm/households/${householdId}/meeting-prep/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j?.error === "string" ? j.error : `Export failed (${res.status})`,
        );
      }
      const blob = await res.blob();
      // JSDOM (and locked-down browsers) may lack createObjectURL — guard so a
      // successful export still marks done even when the download can't fire.
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${kind === "brief" ? "meeting-prep-brief" : "meeting-agenda"}-${meetingDate}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      const nextExported = exported.includes(kind) ? exported : [...exported, kind];
      setExported(nextExported);
      // Once every selected doc has exported, the draft is "used" — drop it.
      if (docs.every((d) => nextExported.includes(d))) {
        try {
          window.localStorage.removeItem(draftStorageKey(householdId));
        } catch {
          // ignore
        }
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  // ---- Setup step ----------------------------------------------------------
  if (step === "setup") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Header householdId={householdId} householdName={householdName} />

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <span>{error}</span>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="block font-medium underline underline-offset-2 disabled:opacity-50"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className={fieldLabelClassName} htmlFor="mp-focus">
              Meeting focus <span className="text-crit">*</span>
            </label>
            <textarea
              id="mp-focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What is this meeting about? e.g. Annual review, retirement readiness, tax planning."
              className={textareaClassName}
            />
          </div>

          <div>
            <label className={fieldLabelClassName} htmlFor="mp-context">
              Additional context for the AI (optional)
            </label>
            <textarea
              id="mp-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              maxLength={10000}
              placeholder="Anything the draft should know that isn't already in the CRM."
              className={textareaClassName}
            />
          </div>

          <div>
            <label className={fieldLabelClassName} htmlFor="mp-date">
              Meeting date
            </label>
            <input
              id="mp-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className={inputClassName}
            />
          </div>

          <fieldset>
            <legend className={fieldLabelClassName}>Documents to generate</legend>
            <div className="space-y-2">
              {MEETING_PREP_DOC_KINDS.map((kind) => (
                <label
                  key={kind}
                  htmlFor={`mp-doc-${kind}`}
                  className="flex items-center gap-2 text-[14px] text-ink-2"
                >
                  <input
                    id={`mp-doc-${kind}`}
                    type="checkbox"
                    checked={docs.includes(kind)}
                    onChange={() => toggleDoc(kind)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  {DOC_LABELS[kind]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-[var(--radius-sm)] border border-hair bg-card px-3 py-3">
            <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
              Summarizing activity since your last meeting
              <FieldTooltip text="The draft summarizes notes, tasks, and activity newer than this date. Left blank, it uses your last logged meeting or call, falling back to the past 90 days." />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[13px] text-ink-3">Since</span>
              <input
                type="date"
                aria-label="Lookback start date"
                value={windowStart ?? ""}
                onChange={(e) => setWindowStart(e.target.value || null)}
                className={`${inputBaseClassName} w-44`}
              />
            </div>
            <p className="mt-2 text-[12px] text-ink-4">
              {hasPlanningClient
                ? "Portfolio data from the linked planning client."
                : "Portfolio data from CRM-tracked accounts."}
            </p>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Generating step -----------------------------------------------------
  if (step === "generating") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Header householdId={householdId} householdName={householdName} />
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-hair border-t-accent"
            aria-hidden="true"
          />
          <p className="text-[14px] text-ink-2">Gathering CRM data and drafting…</p>
        </div>
      </div>
    );
  }

  // ---- Review step ---------------------------------------------------------
  const generatedDocs = docs.filter((d) => draft?.[d]);
  const brief = draft?.brief ?? null;
  const agenda = draft?.agenda ?? null;

  // Export 400s on a required field the advisor blanked out post-generation
  // (an emptied briefing, or an agenda item title). Catch it client-side with
  // a clearer hint instead of surfacing the API's generic error.
  function exportDisabledReason(kind: MeetingPrepDocKind): string | null {
    if (kind === "brief") {
      if (!brief || brief.briefing.trim().length === 0) {
        return "Add a briefing before exporting";
      }
    }
    if (kind === "agenda") {
      if (!agenda || agenda.agendaItems.some((item) => item.title.trim().length === 0)) {
        return "Every agenda item needs a title";
      }
    }
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Header householdId={householdId} householdName={householdName} />

      {restoredBanner && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-hair bg-card px-3 py-2 text-[13px] text-ink-2">
          <span>Restored an unsaved draft.</span>
          <button
            type="button"
            onClick={() => setRestoredBanner(false)}
            className="text-ink-3 underline underline-offset-2 hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {exportError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{exportError}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-hair">
        {generatedDocs.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setActiveTab(kind)}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium ${
              activeTab === kind
                ? "border-accent text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2"
            }`}
          >
            {kind === "brief" ? "Prep Brief" : "Client Agenda"}
            {exported.includes(kind) && <span className="ml-1.5 text-accent">✓</span>}
          </button>
        ))}
      </div>

      {activeTab === "brief" && brief && (
        <BriefEditor brief={brief} data={data} onChange={updateBrief} />
      )}

      {activeTab === "agenda" && agenda && (
        <AgendaEditor agenda={agenda} onChange={updateAgendaItems} />
      )}

      {/* Footer */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-5">
        <button type="button" onClick={() => setStep("setup")} className="btn-ghost">
          Regenerate
        </button>
        <div className="flex flex-wrap items-end gap-2">
          {generatedDocs.map((kind) => {
            const disabledReason = exportDisabledReason(kind);
            return (
              <div key={kind} className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => handleExport(kind)}
                  disabled={exporting !== null || disabledReason !== null}
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exporting === kind
                    ? "Exporting…"
                    : `Export ${kind === "brief" ? "Brief" : "Agenda"} PDF`}
                  {exported.includes(kind) && exporting !== kind && (
                    <span className="ml-1.5">✓</span>
                  )}
                </button>
                {disabledReason && (
                  <p className="text-[12px] text-ink-4">{disabledReason}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Header({
  householdId,
  householdName,
}: {
  householdId: string;
  householdName: string;
}) {
  return (
    <div className="mb-6">
      <Link
        href={`/crm/households/${householdId}`}
        className="text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
      >
        Back to household
      </Link>
      <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.015em] text-ink">
        Meeting prep<span className="text-accent">.</span>
      </h1>
      <p className="mt-1 text-[13px] text-ink-3">{householdName}</p>
    </div>
  );
}

function BriefEditor({
  brief,
  data,
  onChange,
}: {
  brief: PrepBriefDraft;
  data: MeetingPrepBattery | null;
  onChange: (patch: Partial<PrepBriefDraft>) => void;
}) {
  const tasks = data?.outstandingTasks ?? [];
  const portfolio = data?.portfolio ?? null;

  return (
    <div className="space-y-5">
      <div>
        <label className={fieldLabelClassName} htmlFor="mp-briefing">
          Briefing
        </label>
        <textarea
          id="mp-briefing"
          value={brief.briefing}
          onChange={(e) => onChange({ briefing: e.target.value })}
          rows={6}
          className={textareaClassName}
        />
      </div>

      {BRIEF_LIST_SECTIONS.map(({ key, label }) => (
        <div key={key}>
          <label className={fieldLabelClassName} htmlFor={`mp-${key}`}>
            {label} <span className="font-normal text-ink-4">(one per line)</span>
          </label>
          <textarea
            id={`mp-${key}`}
            value={(brief[key] as string[]).join("\n")}
            onChange={(e) => onChange({ [key]: parseLines(e.target.value) } as Partial<PrepBriefDraft>)}
            rows={4}
            className={textareaClassName}
          />
        </div>
      ))}

      {/* Read-only deterministic blocks — re-derived at export, shown for context. */}
      <div className="space-y-3 rounded-[var(--radius-md)] border border-hair bg-card px-4 py-4">
        <p className="text-[12px] text-ink-4">This data is refreshed at export time.</p>

        <div>
          <h3 className="mb-2 text-[13px] font-medium text-ink-2">
            Outstanding tasks ({tasks.length})
          </h3>
          {tasks.length === 0 ? (
            <p className="text-[13px] text-ink-4">No outstanding tasks.</p>
          ) : (
            <ul className="space-y-1">
              {tasks.slice(0, 8).map((t) => (
                <li key={t.id} className="text-[13px] text-ink-2">
                  {t.title}
                  {t.dueDate && <span className="tabular ml-2 text-ink-4">due {t.dueDate}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {portfolio && (
          <div>
            <h3 className="mb-2 text-[13px] font-medium text-ink-2">
              Portfolio
              <span className="tabular ml-2 text-ink">{currency.format(portfolio.total)}</span>
            </h3>
            <ul className="space-y-1">
              {portfolio.accounts.slice(0, 8).map((a, i) => (
                <li key={i} className="flex justify-between text-[13px] text-ink-2">
                  <span>{a.name}</span>
                  <span className="tabular text-ink-3">
                    {a.balance != null ? currency.format(a.balance) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function AgendaEditor({
  agenda,
  onChange,
}: {
  agenda: AgendaDraft;
  onChange: (items: AgendaDraft["agendaItems"]) => void;
}) {
  const items = agenda.agendaItems;

  function update(index: number, patch: Partial<AgendaDraft["agendaItems"][number]>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function add() {
    if (items.length >= 8) return;
    onChange([...items, { title: "", description: "" }]);
  }

  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div
          key={i}
          className="space-y-2 rounded-[var(--radius-md)] border border-hair bg-card px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="tabular text-[13px] text-ink-4">{i + 1}.</span>
            <input
              aria-label={`Agenda item ${i + 1} title`}
              value={item.title}
              onChange={(e) => update(i, { title: e.target.value })}
              maxLength={200}
              placeholder="Topic"
              className={`${inputBaseClassName} flex-1 min-w-0`}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={items.length <= 1}
              className="text-[12px] text-ink-3 underline underline-offset-2 hover:text-crit disabled:opacity-40"
            >
              Remove
            </button>
          </div>
          <textarea
            aria-label={`Agenda item ${i + 1} description`}
            value={item.description}
            onChange={(e) => update(i, { description: e.target.value })}
            rows={2}
            maxLength={600}
            placeholder="Optional detail"
            className={textareaClassName}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={items.length >= 8}
        className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add item
      </button>
      {items.length >= 8 && (
        <p className="text-[12px] text-ink-4">Maximum of 8 agenda items.</p>
      )}
    </div>
  );
}
