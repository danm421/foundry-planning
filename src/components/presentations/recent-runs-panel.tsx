"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClientAccess } from "@/components/client-access-provider";

type RunStatus = "queued" | "running" | "done" | "failed";

interface Run {
  id: string;
  kind: string;
  status: RunStatus;
  triggeredByEmail: string | null;
  createdAt: string;
  resultDocumentId: string | null;
  error: string | null;
  requestPayload?: unknown; // present on presentation runs → enables Retry
}

interface Props {
  clientId: string;
  householdId: string;
  /** Bump from the parent to force an immediate refetch (after a new run is queued). */
  refreshKey: number;
}

/**
 * Status pill classes follow the codebase pattern established in crm-task-side-panel:
 * border-<token>/<opacity> text-<token> bg-<token>/<opacity>
 *
 * done    → accent verdigris (action-adjacent; a completed generation is a deliverable)
 * running → accent with pulse (in-flight action)
 * queued  → neutral ink-2 / card-2 (pending, no urgency)
 * failed  → crit semantic red
 */
const STATUS_PILL: Record<RunStatus, { label: string; className: string }> = {
  done: {
    label: "Done",
    className: "border-accent/40 text-accent-ink bg-accent/10",
  },
  running: {
    label: "Running",
    className: "border-accent/40 text-accent-ink bg-accent/10 animate-pulse",
  },
  queued: {
    label: "Queued",
    className: "border-hair text-ink-2 bg-card-2",
  },
  failed: {
    label: "Failed",
    className: "border-crit/40 text-crit bg-crit/10",
  },
};

const POLL_MS = 3000;

export function RecentRunsPanel({ clientId, householdId, refreshKey }: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRuns = useCallback(async (): Promise<Run[] | null> => {
    try {
      const res = await fetch(`/api/clients/${clientId}/generation-runs`, {
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
  }, [clientId]);

  // Retry a failed presentation by re-POSTing its stored request payload.
  const handleRetry = useCallback(
    async (run: Run) => {
      try {
        await fetch(`/api/clients/${clientId}/presentations/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(run.requestPayload),
        });
        setPollNonce((n) => n + 1); // restart the poll cycle so the new queued run is tracked
      } catch {
        // best-effort — next poll/refresh will reflect state
      }
    },
    [clientId],
  );

  // Poll while anything is in flight; stop when all settled.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const latest = await fetchRuns();
      if (cancelled) return;
      const inFlight = latest?.some(
        (r) => r.status === "queued" || r.status === "running",
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
    <aside className="w-full">
      <h2 className="mb-2 text-sm font-semibold text-ink">Recent runs</h2>
      <div className="rounded border border-hair bg-card">
        {runs === null && (
          <p className="px-3 py-4 text-sm text-ink-3">Loading…</p>
        )}
        {runs !== null && runs.length === 0 && (
          <p className="px-3 py-4 text-sm text-ink-3">
            No reports generated yet.
          </p>
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
              {runs.map((r) => {
                const pill = STATUS_PILL[r.status];
                return (
                  <tr
                    key={r.id}
                    className="border-b border-hair last:border-0 align-top"
                  >
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
                      {r.status === "done" && r.resultDocumentId ? (
                        <a
                          className="text-accent underline"
                          href={`/api/crm/households/${householdId}/documents/${r.resultDocumentId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open
                        </a>
                      ) : r.status === "failed" ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="text-crit"
                            title={r.error ?? undefined}
                          >
                            Failed
                          </span>
                          {canEdit &&
                            r.kind === "presentation" &&
                            r.requestPayload != null && (
                              <button
                                type="button"
                                className="text-accent underline"
                                onClick={() => handleRetry(r)}
                              >
                                Retry
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
