"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";
import type { MeetingPrepSetup, PrepBriefDraft, AgendaDraft } from "@/lib/crm/meeting-prep/schemas";

type Draft = { brief: PrepBriefDraft | null; agenda: AgendaDraft | null };
type RunStatus = "queued" | "analyzing" | "running" | "done" | "failed";

interface Run {
  id: string;
  status: RunStatus;
  triggeredByEmail: string | null;
  createdAt: string;
  error: string | null;
  requestPayload: MeetingPrepSetup | null;
}

interface RecentRunsProps {
  householdId: string;
  /** Bump to force an immediate refetch (parent queued a new run). */
  refreshKey: number;
  /** Called with a done run's payload after any confirm has passed. */
  onOpenRun: (
    payload: { draft: Draft; data: MeetingPrepBattery | null },
    setup: MeetingPrepSetup | null,
  ) => void;
  /** Return true when it's safe to replace current work (may window.confirm). */
  confirmReplace: () => boolean;
}

/** Status pill classes — same convention as presentations RecentRunsPanel. */
const STATUS_PILL: Record<RunStatus, { label: string; className: string }> = {
  done: { label: "Done", className: "border-accent/40 text-accent-ink bg-accent/10" },
  analyzing: {
    label: "Analyzing…",
    className: "border-accent/40 text-accent-ink bg-accent/10 animate-pulse",
  },
  running: {
    label: "Drafting…",
    className: "border-accent/40 text-accent-ink bg-accent/10 animate-pulse",
  },
  queued: { label: "Queued", className: "border-hair text-ink-2 bg-card-2" },
  failed: { label: "Failed", className: "border-crit/40 text-crit bg-crit/10" },
};

const POLL_MS = 3000;
const MAX_RUNS = 5;

export function MeetingPrepRecentRuns({
  householdId,
  refreshKey,
  onOpenRun,
  confirmReplace,
}: RecentRunsProps) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRuns = useCallback(async (): Promise<Run[] | null> => {
    try {
      const res = await fetch(`/api/crm/households/${householdId}/meeting-prep/runs`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!Array.isArray(json.runs)) return null;
      const next = json.runs as Run[];
      setRuns(next);
      return next;
    } catch {
      return null; // transient — keep last good state, next poll retries
    }
  }, [householdId]);

  const handleOpen = useCallback(
    async (run: Run) => {
      if (!confirmReplace()) return;
      setOpening(run.id);
      try {
        const res = await fetch(
          `/api/crm/households/${householdId}/meeting-prep/runs/${run.id}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const { run: detail } = (await res.json()) as {
          run: Run & { resultPayload: { draft: Draft; data: MeetingPrepBattery | null } | null };
        };
        if (detail.resultPayload) {
          onOpenRun(detail.resultPayload, detail.requestPayload);
        }
      } catch {
        // best-effort — leave the panel as is
      } finally {
        setOpening(null);
      }
    },
    [householdId, onOpenRun, confirmReplace],
  );

  const handleRetry = useCallback(
    async (run: Run) => {
      if (!run.requestPayload) return;
      setRetrying(run.id);
      setRetryError(null);
      try {
        const res = await fetch(`/api/crm/households/${householdId}/meeting-prep/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(run.requestPayload),
        });
        if (!res.ok) {
          // Rate limit / unconfigured AI / server error — surface the server's
          // message instead of pretending a new run was queued.
          const j = await res.json().catch(() => ({}));
          setRetryError(
            typeof j?.error === "string" ? j.error : `Retry failed (${res.status})`,
          );
          return;
        }
        setPollNonce((n) => n + 1); // restart the poll cycle to track the new run
      } catch {
        setRetryError("Retry failed. Please try again.");
      } finally {
        setRetrying(null);
      }
    },
    [householdId],
  );

  // Poll while anything is in flight; stop when all settled. Also clears any
  // stale retry error — this effect re-runs exactly when a retry succeeded
  // (pollNonce) or the parent queued a fresh run (refreshKey).
  useEffect(() => {
    setRetryError(null);
    let cancelled = false;
    const tick = async () => {
      const latest = await fetchRuns();
      if (cancelled) return;
      const inFlight = latest?.some(
        (r) => r.status === "queued" || r.status === "analyzing" || r.status === "running",
      );
      if (inFlight) timer.current = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchRuns, refreshKey, pollNonce]);

  return (
    <aside className="mt-8 w-full">
      <h2 className="mb-2 text-sm font-semibold text-ink">Recent runs</h2>
      {retryError && (
        <p role="alert" className="mb-2 text-[13px] text-crit">
          {retryError}
        </p>
      )}
      <div className="rounded border border-hair bg-card">
        {runs === null && <p className="px-3 py-4 text-sm text-ink-3">Loading…</p>}
        {runs !== null && runs.length === 0 && (
          <p className="px-3 py-4 text-sm text-ink-3">No drafts generated yet.</p>
        )}
        {runs !== null && runs.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hair text-left text-[11px] uppercase tracking-[0.12em] text-ink-2">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, MAX_RUNS).map((r) => {
                const pill = STATUS_PILL[r.status];
                return (
                  <tr key={r.id} className="border-b border-hair last:border-0 align-top">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-2 tabular">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "done" ? (
                        <button
                          type="button"
                          className="text-accent underline disabled:opacity-50"
                          disabled={opening === r.id}
                          onClick={() => handleOpen(r)}
                        >
                          {opening === r.id ? "Opening…" : "Open draft"}
                        </button>
                      ) : r.status === "failed" ? (
                        <span className="flex items-center gap-2">
                          <span className="text-crit" title={r.error ?? undefined}>
                            Failed
                          </span>
                          {r.requestPayload != null && (
                            <button
                              type="button"
                              className="text-accent underline disabled:opacity-50"
                              disabled={retrying === r.id}
                              onClick={() => handleRetry(r)}
                            >
                              {retrying === r.id ? "Retrying…" : "Retry"}
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}
