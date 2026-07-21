// src/components/forge/approval-card.tsx
//
// Presentational component that renders an `approval_required` payload.
//
// Two shapes, because one yes/no decision and a batch of them are different
// problems:
//   • ONE change (the common case — build_plan, create_household, most
//     propose_changes turns) collapses to a plain Reject / Approve pair.
//   • SEVERAL changes keep per-row Confirm/Reject toggles, batch helpers, an
//     explicit "Decline all", and an Apply button gated on at least one confirm.
//
// Every row still DEFAULTS to "reject" — that fail-safe is deliberate and
// stays. What was unsafe was pairing it with an always-enabled, accent-filled
// `Apply selected (0)`: the most affirmative-looking control in the card
// submitted a decline for anyone who didn't first find the small per-row
// Confirm pill. So no affirmative control may ever submit a decline — the
// single-change primary means confirm, and the batch primary is unavailable
// until something is actually confirmed. Declining is its own labelled action.
//
// Owns only the per-row verdict state; the panel decides where to mount it.

"use client";

import { useMemo, useState } from "react";
// Re-export the canonical types defined in use-forge-stream so the panel
// and hook share the same shape without a duplicate declaration.
export type { WritePreview, ApprovalCall } from "./use-forge-stream";
import type { WritePreview, ApprovalCall } from "./use-forge-stream";

type Verdict = "confirm" | "reject";

interface ApprovalCardProps {
  previews: WritePreview[];
  calls: ApprovalCall[];
  busy: boolean;
  onSubmit: (decisions: Record<string, Verdict>) => void;
  onCancel: () => void;
  /** When set, the card collapses to a READ-ONLY receipt of a settled decision
   *  (per-call confirm/reject) — no live controls. Used after the advisor has
   *  resolved the approval so the record stays in the thread instead of
   *  vanishing. Render-only: a receipt NEVER derives or re-submits a decision. */
  resolved?: { id: string; choice: Verdict }[];
}

export function ApprovalCard({
  previews,
  calls,
  busy,
  onSubmit,
  onCancel,
  resolved,
}: ApprovalCardProps) {
  // Default every row to "reject" — fail-safe. (Hooks run unconditionally; the
  // receipt branch below only changes what we render, never the hook order.)
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

  /** Submit one verdict for every call — the single-change card's whole API. */
  function submitAll(v: Verdict) {
    const map: Record<string, Verdict> = {};
    for (const call of calls) map[call.id] = v;
    onSubmit(map);
  }

  // Receipt mode: a compact, read-only record of a settled decision. No buttons.
  if (resolved) {
    const choiceById = new Map(resolved.map((r) => [r.id, r.choice]));
    const approvedCount = resolved.filter((r) => r.choice === "confirm").length;
    return (
      <div className="rounded-[var(--radius)] border border-hair bg-card-2/40">
        <div className="flex items-center gap-2 border-b border-hair px-4 py-2.5">
          <span aria-hidden className="text-ink-3">✓</span>
          <span className="text-[12px] font-medium text-ink-2">
            {approvedCount} of {resolved.length} change{resolved.length === 1 ? "" : "s"} approved
          </span>
        </div>
        <div className="divide-y divide-hair">
          {previews.map((preview, i) => {
            const choice = choiceById.get(calls[i]?.id ?? "") ?? "reject";
            return (
              <div key={i} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <p className="text-[13px] text-ink-2">{preview.summary}</p>
                <span
                  className={[
                    "shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-medium",
                    choice === "confirm" ? "bg-accent/10 text-accent-ink" : "bg-crit/10 text-crit",
                  ].join(" ")}
                >
                  {choice === "confirm" ? "Approved" : "Declined"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Shared chrome for both live shapes (the receipt above has its own, calmer
  // treatment — it is a record, not a prompt).
  const cardShell = "rounded-[var(--radius)] border border-warn/40 bg-warn/5";
  const header = (
    <div className="flex items-center gap-2 border-b border-warn/30 px-4 py-3">
      <span aria-hidden className="text-warn">⚠</span>
      <span className="text-[13px] font-semibold text-warn">
        Forge wants to make {previews.length} change{previews.length === 1 ? "" : "s"}
      </span>
    </div>
  );

  const detailList = (preview: WritePreview) =>
    preview.details && preview.details.length > 0 ? (
      <ul className="space-y-0.5">
        {preview.details.map((line, j) => (
          <li key={j} className="text-[12px] text-ink-2">
            {line}
          </li>
        ))}
      </ul>
    ) : null;

  // ── Single change: one decision, two controls. No per-row pills to discover,
  // and no primary that can mean "decline". ──
  if (previews.length === 1) {
    const preview = previews[0];
    return (
      <div className={cardShell}>
        {header}
        <div className="px-4 py-3">
          <p className="mb-1.5 text-[13px] font-medium text-ink">{preview.summary}</p>
          {detailList(preview)}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-warn/30 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => submitAll("reject")}
            className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-1 text-[12px] font-medium text-crit hover:bg-crit/20 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submitAll("confirm")}
            className="rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cardShell}>
      {header}

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
              {detailList(preview)}
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

        {/* The decline path, named for what it does. It was labelled "Cancel",
            which reads as "dismiss without deciding" — but it has always
            resumed the graph with an all-reject verdict. */}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-3 hover:bg-card-hover hover:text-ink disabled:opacity-50"
        >
          Decline all
        </button>
        {/* Gated on confirmedCount: with nothing confirmed this button would
            submit a decline while looking like the affirmative action. */}
        <button
          type="button"
          aria-label={applyLabel}
          disabled={busy || confirmedCount === 0}
          onClick={() => onSubmit(decisions)}
          className="rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          {applyLabel}
        </button>
      </div>
    </div>
  );
}
