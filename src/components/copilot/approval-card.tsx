// src/components/copilot/approval-card.tsx
//
// Presentational component that renders an `approval_required` payload:
// a list of WritePreview rows (one per write tool call) with per-row
// Confirm/Reject toggles, batch Confirm-all/Reject-all, and an Apply button.
// Defaults every row to "reject" (fail-safe). Owns only the per-row verdict
// state; the panel (Task 65) decides where to mount it.

"use client";

import { useMemo, useState } from "react";
// Re-export the canonical types defined in use-copilot-stream so the panel
// and hook share the same shape without a duplicate declaration.
export type { WritePreview, ApprovalCall } from "./use-copilot-stream";
import type { WritePreview, ApprovalCall } from "./use-copilot-stream";

type Verdict = "confirm" | "reject";

interface ApprovalCardProps {
  previews: WritePreview[];
  calls: ApprovalCall[];
  busy: boolean;
  onSubmit: (decisions: Record<string, Verdict>) => void;
  onCancel: () => void;
}

export function ApprovalCard({ previews, calls, busy, onSubmit, onCancel }: ApprovalCardProps) {
  // Default every row to "reject" — fail-safe.
  const [verdicts, setVerdicts] = useState<Verdict[]>(() => previews.map(() => "reject"));

  function setRow(i: number, v: Verdict) {
    setVerdicts((prev) => prev.map((cur, idx) => (idx === i ? v : cur)));
  }

  function confirmAll() {
    setVerdicts(previews.map(() => "confirm"));
  }

  function rejectAll() {
    setVerdicts(previews.map(() => "reject"));
  }

  // Build the decisions map: { [callId]: "confirm" | "reject" }
  const decisions = useMemo<Record<string, Verdict>>(() => {
    const map: Record<string, Verdict> = {};
    calls.forEach((call, i) => {
      map[call.id] = verdicts[i] ?? "reject";
    });
    return map;
  }, [calls, verdicts]);

  const confirmedCount = verdicts.filter((v) => v === "confirm").length;
  const applyLabel = `Apply selected (${confirmedCount})`;

  return (
    <div className="rounded-[var(--radius)] border border-warn/40 bg-warn/5">
      {/* Amber header */}
      <div className="flex items-center gap-2 border-b border-warn/30 px-4 py-3">
        <span aria-hidden className="text-warn">⚠</span>
        <span className="text-[13px] font-semibold text-warn">
          Forge wants to make {previews.length} change{previews.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Preview rows */}
      <div className="divide-y divide-hair">
        {previews.map((preview, i) => {
          const verdict = verdicts[i] ?? "reject";
          return (
            <div key={i} className="px-4 py-3">
              <div className="mb-1.5 flex items-start justify-between gap-3">
                <p className="text-[13px] font-medium text-ink">{preview.summary}</p>
                {/* Per-row verdict pills */}
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    aria-label={`Confirm row ${i + 1}`}
                    aria-pressed={verdict === "confirm"}
                    disabled={busy}
                    onClick={() => setRow(i, "confirm")}
                    className={[
                      "rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[12px] font-medium transition-colors disabled:opacity-50",
                      verdict === "confirm"
                        ? "border-accent/40 bg-accent text-accent-on"
                        : "border-hair bg-card text-ink-3 hover:bg-card-hover hover:text-ink",
                    ].join(" ")}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject row ${i + 1}`}
                    aria-pressed={verdict === "reject"}
                    disabled={busy}
                    onClick={() => setRow(i, "reject")}
                    className={[
                      "rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[12px] font-medium transition-colors disabled:opacity-50",
                      verdict === "reject"
                        ? "border-crit/40 bg-crit/10 text-crit"
                        : "border-hair bg-card text-ink-3 hover:bg-card-hover hover:text-ink",
                    ].join(" ")}
                  >
                    Reject
                  </button>
                </div>
              </div>
              {preview.details && preview.details.length > 0 && (
                <ul className="space-y-0.5">
                  {preview.details.map((line, j) => (
                    <li key={j} className="text-[12px] text-ink-2">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: batch actions + apply/cancel */}
      <div className="flex flex-wrap items-center gap-2 border-t border-warn/30 px-4 py-3">
        <button
          type="button"
          aria-label="Confirm all"
          disabled={busy}
          onClick={confirmAll}
          className="rounded-[var(--radius-sm)] border border-accent/40 bg-accent/10 px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent/20 disabled:opacity-50"
        >
          Confirm all
        </button>
        <button
          type="button"
          aria-label="Reject all"
          disabled={busy}
          onClick={rejectAll}
          className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-2.5 py-1 text-[12px] font-medium text-crit hover:bg-crit/20 disabled:opacity-50"
        >
          Reject all
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-3 hover:bg-card-hover hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          aria-label={applyLabel}
          disabled={busy}
          onClick={() => onSubmit(decisions)}
          className="rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          {applyLabel}
        </button>
      </div>
    </div>
  );
}
