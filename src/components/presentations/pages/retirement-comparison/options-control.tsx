"use client";

import { useState } from "react";
import { useScenarioOptions, useClientId } from "@/components/presentations/options-context";
import type { RetirementComparisonOptions } from "@/lib/presentations/pages/retirement-comparison/types";

interface Props {
  value: RetirementComparisonOptions;
  onChange: (next: RetirementComparisonOptions) => void;
}

const TONES = ["concise", "detailed", "plain"] as const;
const LENGTHS = ["short", "medium", "long"] as const;

export function RetirementComparisonOptionsControl({ value, onChange }: Props) {
  const scenarios = useScenarioOptions();
  const clientId = useClientId();
  // Orphan integration-test scenarios (changes-writer.test.ts mints
  // `writer-test-<uuid>` rows and deletes them in afterEach; crashes leak them)
  // pile up in the picker. Hide them in the UI; leave DB rows alone.
  const liveScenarios = scenarios.filter(
    (s) => !s.name.startsWith("writer-test-"),
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force: boolean) {
    if (!value.scenarioId) {
      setError("Pick a comparison scenario first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/presentations/retirement-comparison-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: value.scenarioId,
          tone: value.ai.tone,
          length: value.ai.length,
          customInstructions: value.ai.customInstructions,
          force,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      const j = (await res.json()) as { markdown: string; generatedAt: string; hash: string };
      onChange({
        ...value,
        ai: { ...value.ai, generatedText: j.markdown, generatedAt: j.generatedAt, sourceHash: j.hash },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-ink-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Comparison scenario (vs Base Case)</span>
        <select
          aria-label="Comparison scenario"
          className="w-full rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          value={value.scenarioId}
          onChange={(e) => onChange({ ...value, scenarioId: e.target.value })}
        >
          <option value="">— Select a scenario —</option>
          {liveScenarios.map((sc) => (
            <option key={sc.id} value={sc.id}>{sc.name}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2 rounded border border-hair p-2">
        <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">AI summary</span>
        <label className="flex items-center justify-between gap-2">
          <span>Tone</span>
          <select
            aria-label="AI tone"
            className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
            value={value.ai.tone}
            onChange={(e) => onChange({ ...value, ai: { ...value.ai, tone: e.target.value as RetirementComparisonOptions["ai"]["tone"] } })}
          >
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Length</span>
          <select
            aria-label="AI length"
            className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
            value={value.ai.length}
            onChange={(e) => onChange({ ...value, ai: { ...value.ai, length: e.target.value as RetirementComparisonOptions["ai"]["length"] } })}
          >
            {LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Custom instructions</span>
          <textarea
            aria-label="AI custom instructions"
            className="w-full rounded border border-hair bg-card-2 px-2 py-1 text-ink"
            rows={2}
            maxLength={2000}
            value={value.ai.customInstructions}
            onChange={(e) => onChange({ ...value, ai: { ...value.ai, customInstructions: e.target.value } })}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={generating}
            className="rounded bg-accent px-2 py-1 text-card disabled:opacity-50"
            onClick={() => generate(false)}
          >
            {generating ? "Generating…" : value.ai.generatedText ? "Regenerate" : "Generate"}
          </button>
          <button
            type="button"
            disabled={generating}
            className="rounded border border-hair px-2 py-1 disabled:opacity-50"
            onClick={() => generate(true)}
          >
            Force
          </button>
          {value.ai.generatedAt ? (
            <span className="text-[11px] text-ink-3">Generated {new Date(value.ai.generatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        {error ? <span className="text-[11px] text-crit">{error}</span> : null}
      </div>

      <div className="flex flex-col gap-1">
        {([["showPortfolioMatrix", "Show portfolio matrix"], ["showAiSummary", "Show AI summary"], ["showConfidenceRange", "Show range of outcomes"]] as const).map(
          ([key, lbl]) => (
            <label key={key} className="flex items-center gap-2 hover:text-ink">
              <input
                type="checkbox"
                className="accent-accent"
                checked={value[key]}
                onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
              />
              <span>{lbl}</span>
            </label>
          ),
        )}
      </div>

      <div className="flex flex-col gap-2 rounded border border-hair p-2">
        <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Max spending</span>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.maxSpend.show}
            onChange={(e) => onChange({ ...value, maxSpend: { ...value.maxSpend, show: e.target.checked } })}
          />
          <span>Show max spending</span>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Confidence target</span>
          <select
            aria-label="Max-spending confidence target"
            className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
            value={String(value.maxSpend.targetConfidence)}
            onChange={(e) =>
              onChange({ ...value, maxSpend: { ...value.maxSpend, targetConfidence: Number(e.target.value) } })
            }
          >
            {["0.75", "0.8", "0.85", "0.9"].map((v) => (
              <option key={v} value={v}>{`${Math.round(Number(v) * 100)}%`}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
