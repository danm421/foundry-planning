"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 3000;

type SkippedClient = { householdId: string; name: string; reason: string };
type BatchStatus = {
  id: string;
  status: "queued" | "running" | "done" | "done_with_errors" | "failed";
  totalClients: number;
  done: number;
  failed: number;
  remaining: number;
  skippedCount: number;
  skippedClients: SkippedClient[];
};

const STATUS_PILL: Record<BatchStatus["status"], { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-hair text-ink-2 bg-card-2" },
  running: { label: "Running", className: "border-accent/40 text-accent-ink bg-accent/10 animate-pulse" },
  done: { label: "Done", className: "border-accent/40 text-accent-ink bg-accent/10" },
  done_with_errors: { label: "Done (with errors)", className: "border-warn/40 text-warn bg-warn/10" },
  failed: { label: "Failed", className: "border-crit/40 text-crit bg-crit/10" },
};

function isActive(s: BatchStatus["status"]): boolean {
  return s === "queued" || s === "running";
}

export default function ComplianceExportPanel() {
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollStalled, setPollStalled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the latest batch id on mount so a refresh mid-run reattaches the poll.
  const loadLatest = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/firm/compliance-exports", { cache: "no-store" });
      if (!res.ok) return null;
      const { batches } = (await res.json()) as { batches: Array<{ id: string }> };
      return batches[0]?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const fetchStatus = useCallback(async (id: string): Promise<BatchStatus | null> => {
    try {
      const res = await fetch(`/api/firm/compliance-exports/${id}`, { cache: "no-store" });
      if (!res.ok) return null;
      const b = (await res.json()) as BatchStatus;
      setBatch(b);
      return b;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const id = batch?.id ?? (await loadLatest());
      if (cancelled || !id) return;
      const latest = await fetchStatus(id);
      if (cancelled) return;
      if (latest === null) {
        // Transient failure — keep retrying so one blip doesn't freeze the pill.
        setPollStalled(true);
        timer.current = setTimeout(tick, POLL_MS);
      } else {
        setPollStalled(false);
        if (isActive(latest.status)) timer.current = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [batch?.id, loadLatest, fetchStatus]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/firm/compliance-exports", { method: "POST" });
      if (res.status === 409) {
        setError("An export is already running.");
      } else if (!res.ok) {
        setError("Could not start the export.");
      } else {
        const { batchId } = (await res.json()) as { batchId: string };
        const seeded = await fetchStatus(batchId); // seeds batch.id -> starts the poll effect
        if (!seeded) {
          // The export IS running server-side; seed a placeholder so the poll
          // effect engages and the retry loop recovers the real status.
          setBatch({
            id: batchId,
            status: "queued",
            totalClients: 0,
            done: 0,
            failed: 0,
            remaining: 0,
            skippedCount: 0,
            skippedClients: [],
          });
        }
      }
    } catch {
      setError("Could not start the export.");
    } finally {
      setStarting(false);
    }
  }, [fetchStatus]);

  const running = batch ? isActive(batch.status) : false;
  const pill = batch ? STATUS_PILL[batch.status] : null;

  return (
    <div className="flex flex-col gap-3 rounded border border-hair bg-card p-[var(--pad-card)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Compliance records export</h2>
          <p className="text-xs text-ink-2">
            Generate a Profile + Balance Sheet PDF for every active client and save it to their
            Documents folder.
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={starting || running}
          className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 text-[13px] font-semibold text-ink-2 transition-colors hover:border-hair-2 hover:bg-card-hover hover:text-ink disabled:opacity-50"
        >
          {running ? "Export running…" : "Export all client records"}
        </button>
      </div>

      {error && <p className="text-xs text-crit" role="alert">{error}</p>}
      {pollStalled && (
        <p className="text-xs text-warn" role="status">Couldn&apos;t refresh export progress — retrying…</p>
      )}

      {batch && pill && (
        <div className="flex flex-col gap-2 border-t border-hair pt-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${pill.className}`}>
              {pill.label}
            </span>
            <span className="text-xs text-ink-2" role="status" aria-live="polite">
              {batch.done}/{batch.totalClients} done
              {batch.failed > 0 && ` · ${batch.failed} failed`}
              {batch.remaining > 0 && ` · ${batch.remaining} remaining`}
              {batch.skippedCount > 0 && ` · ${batch.skippedCount} skipped`}
            </span>
          </div>
          {batch.status !== "queued" && batch.status !== "running" && batch.skippedCount > 0 && (
            <details className="text-xs text-ink-2">
              <summary className="cursor-pointer">Skipped clients ({batch.skippedCount})</summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {batch.skippedClients.map((s) => (
                  <li key={s.householdId}>{s.name} — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
