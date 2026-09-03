// One section's AI draft: POST the run, poll it, hand back the cards AND the
// scenario the RUN used. The scenario rides on the result so an accepted row
// is stamped with what produced it, not with whatever the picker says by the
// time the advisor clicks Accept. Polling mirrors the Details panel's.
"use client";
import { useEffect, useState } from "react";
import type { ObservationTopic } from "@/lib/schemas/observations";

export type DraftSection = "observation" | "next_step";

export interface DraftSuggestion {
  section: DraftSection;
  topic: ObservationTopic;
  title: string | null;
  body: string;
  owner: "advisor" | "client" | "joint" | null;
  priority: "high" | "medium" | "low" | null;
}

export interface DraftRunResult {
  section: DraftSection;
  scenarioId: string | null;
  suggestions: DraftSuggestion[];
}

const RUN_POLL_MS = 3000;
const RUN_POLL_MAX_FAILURES = 10; // ~30s of a dead endpoint before we bail.

export function useDraftRun(clientId: string) {
  const base = `/api/clients/${clientId}/observations`;
  const [active, setActive] = useState<{ runId: string; section: DraftSection } | null>(null);
  const [result, setResult] = useState<DraftRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const retryOrBail = () => {
      failures += 1;
      if (failures >= RUN_POLL_MAX_FAILURES) {
        setActive(null);
        setError("Couldn't check on the draft. Please try again.");
        return;
      }
      timer = setTimeout(tick, RUN_POLL_MS);
    };

    const tick = async () => {
      try {
        const res = await fetch(`${base}/draft-runs/${active.runId}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          retryOrBail();
          return;
        }
        const run = (await res.json()) as {
          status: string;
          error: string | null;
          scenarioId: string | null;
          suggestions: DraftSuggestion[] | null;
        };
        failures = 0;
        if (run.status === "done") {
          setActive(null);
          setResult({ section: active.section, scenarioId: run.scenarioId ?? null, suggestions: run.suggestions ?? [] });
          return;
        }
        if (run.status === "failed") {
          setActive(null);
          setError(run.error ?? "The AI draft didn't finish. Please try again.");
          return;
        }
        timer = setTimeout(tick, RUN_POLL_MS);
      } catch {
        if (!cancelled) retryOrBail();
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, base]);

  async function start(section: DraftSection) {
    if (active) return;
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${base}/draft-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section }),
      });
      if (res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === "string" ? j.error : "Couldn't start the draft.");
      }
      const { runId } = (await res.json()) as { runId: string };
      setActive({ runId, section });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the draft.");
    }
  }

  function replaceSuggestions(suggestions: DraftSuggestion[]) {
    setResult((prev) => (prev ? { ...prev, suggestions } : prev));
  }

  return {
    start,
    drafting: active !== null,
    result,
    error,
    replaceSuggestions,
    clear: () => setResult(null),
  };
}
