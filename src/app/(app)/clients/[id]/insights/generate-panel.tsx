"use client";

import { useState } from "react";
import type { GeneratedInsights } from "@/lib/insights/generate";

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

/** AI prose panel for the client 360: renders persisted Snapshot / Goals /
 *  Opportunities sections and drives generate/refresh against the insights
 *  API. Props are consumed by `insights-content.tsx` (Task 11) — the shape
 *  must not change without updating that call site. */
export function GeneratePanel({
  clientId,
  stale,
  initial,
}: {
  clientId: string;
  stale: boolean;
  initial: Initial | null;
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
          <Section title="Snapshot" body={sections.snapshot} />
          <Section title="Goals & Plan" body={sections.goals} />
          <Section title="Opportunities & Flags" body={sections.opportunities} />
        </>
      )}
    </div>
  );
}
