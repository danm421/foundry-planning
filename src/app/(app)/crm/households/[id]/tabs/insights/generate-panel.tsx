"use client";

import { useState } from "react";
import type { GeneratedInsights } from "@/lib/insights/generate";
import { MAX_ACTIONS } from "@/lib/insights/schemas";
import type { Signal } from "@/lib/insights/signals";

type Sections = GeneratedInsights;
type Initial = Sections & { generatedAt: string };

function Section({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="whitespace-pre-wrap text-sm text-ink-2">{body}</div>
    </section>
  );
}

/**
 * Ranked shortlist. Each action cites a `signalId` and is shown against that
 * signal's deterministic title, so the advisor reads the recommendation next to
 * the evidence it was drawn from rather than as a free-floating claim.
 *
 * A cited signal can be MISSING even though `dropUncitedActions` guaranteed it
 * existed at generation time: the profile is persisted, and the household's data
 * moves on. Rebalance away a cash drag and `portfolio.cash_drag` stops firing
 * while the stored action still names it. That action is stale advice, not a
 * bug, so it is labelled rather than hidden — hiding it would silently shorten a
 * list the advisor is reading as "the top five".
 */
function ActionList({
  actions,
  signals,
}: {
  actions: Sections["actions"];
  signals: Signal[];
}) {
  if (actions.length === 0) return null;
  const titleById = new Map(signals.map((s) => [s.id, s.title]));

  return (
    <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Where to start</h3>
        {actions.length >= MAX_ACTIONS && (
          <span className="text-[11px] text-ink-3">
            Top <span className="tabular">{MAX_ACTIONS}</span> — every signal is
            listed above
          </span>
        )}
      </div>
      <ol className="flex flex-col gap-4">
        {actions.map((a, i) => {
          const signalTitle = titleById.get(a.signalId);
          return (
            <li key={a.signalId} className="flex gap-3">
              <span className="tabular mt-0.5 text-[11px] text-ink-3">{i + 1}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[11px] text-ink-3">
                  {signalTitle ?? "No longer flagged — data has changed since this was generated"}
                </span>
                <span className="text-sm font-medium text-ink">{a.recommendation}</span>
                <span className="text-sm text-ink-2">{a.why}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** AI narration panel for the client 360: renders the persisted headline,
 *  ranked actions, Snapshot / Goals prose and talking points, and drives
 *  generate/refresh against the insights API. Props are consumed by
 *  `insights-tab.tsx` — the shape must not change without updating that
 *  call site. */
export function GeneratePanel({
  clientId,
  stale,
  initial,
  signals,
}: {
  clientId: string;
  stale: boolean;
  initial: Initial | null;
  signals: Signal[];
}) {
  const [sections, setSections] = useState<Sections | null>(initial);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initial?.generatedAt ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(stale);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/insights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setSections(data.sections);
      setGeneratedAt(data.generatedAt);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-ink-3" role="status" aria-live="polite">
          {generatedAt ? (
            <>
              Generated {new Date(generatedAt).toLocaleString()}
              {dirty && sections ? " · plan data changed" : ""}
            </>
          ) : (
            "AI summary not generated yet"
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-hair disabled:hover:text-ink"
        >
          {loading ? "Generating…" : sections ? "Refresh 360" : "Generate 360"}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 p-3 text-sm text-crit"
        >
          {error}
        </div>
      )}
      {sections && (
        <>
          {sections.headline && (
            <p className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">
              {sections.headline}
            </p>
          )}
          <ActionList actions={sections.actions} signals={signals} />
          <Section title="Snapshot" body={sections.snapshot} />
          <Section title="Goals & Plan" body={sections.goals} />
          {sections.talkingPoints.length > 0 && (
            <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
              <h3 className="mb-2 text-sm font-semibold">Talking points</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                {sections.talkingPoints.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
