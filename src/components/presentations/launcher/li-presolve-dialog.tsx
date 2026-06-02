// src/components/presentations/launcher/li-presolve-dialog.tsx
"use client";

import type { PresolveProgress } from "@/app/(app)/clients/[id]/presentations/use-li-presolve";

export function LiPresolveDialog({
  open,
  progress,
  onCancel,
}: {
  open: boolean;
  progress: PresolveProgress | null;
  onCancel: () => void;
}) {
  if (!open) return null;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const phaseLabel =
    progress?.phase === "monte-carlo"
      ? `Monte Carlo${progress.caseLabel ? ` · ${progress.caseLabel}` : ""}`
      : "Need over time";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[380px] rounded-lg border border-hair bg-card p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-ink">Solving life insurance need…</h3>
        <p className="mt-1 text-[12px] text-ink2">
          {progress ? `${progress.scenarioLabel} — ${phaseLabel}` : "Starting…"}
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-paper">
          <div className="h-2 rounded bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-right text-[11px] text-ink3">{pct}%</p>
        <p className="mt-2 text-[11px] text-ink3">
          This runs the same solve as the solver tab and can take up to a minute per scenario.
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink2 hover:bg-paper"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
