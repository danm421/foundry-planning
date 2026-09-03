// src/components/forge/approval-card.tsx
//
// Presentational component that renders an `approval_required` payload.
//
// One decision, one click. The advisor already asked for these changes in
// chat; the card exists so they can glance at what Forge understood and let it
// through. It used to take two steps for a batch — find and press a small
// per-row Confirm pill, then "Apply selected (N)" — which read as being asked
// to confirm twice. Now:
//   • ONE change (the common case) is a title, a few plain-language facts, and
//     Reject / Approve.
//   • SEVERAL changes list every row INCLUDED by default with a checkbox to
//     leave one out, and a single primary that approves whatever is checked.
//     "Decline all" is its own labelled action.
//
// The one invariant that survives from the old fail-safe design: no
// affirmative-looking control may ever submit a decline. The primary approves
// the checked rows and is unavailable when nothing is checked, so an advisor
// who unticks everything cannot "approve" their way into a rejection.
//
// Detail lines arrive as strings from the server. A short "Label: value" line
// renders as a two-column row with the value in mono when it carries a number;
// anything longer (a cascade note, a sentence) renders as a plain line.
//
// Owns only the per-row inclusion state; the panel decides where to mount it.

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

/** "Add 3 accounts" when every row is the same kind of write; else "3 changes". */
export function batchTitle(previews: WritePreview[]): string {
  const n = previews.length;
  const first = previews[0]?.name ?? "";
  const m = /^(add|update|remove)_(account|expense|income|liability)$/.exec(first);
  if (m && previews.every((p) => p.name === first)) {
    const verb = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const noun =
      m[2] === "liability" ? "liabilities" : m[2] === "income" ? "income sources" : `${m[2]}s`;
    return `${verb} ${n} ${noun}`;
  }
  return `${n} changes`;
}

const LABEL_VALUE = /^([^:]{1,28}): (.{1,40})$/;

function DetailLine({ text }: { text: string }) {
  const m = LABEL_VALUE.exec(text);
  if (!m) return <li className="text-[12px] leading-5 text-ink-3">{text}</li>;
  const numeric = /\d/.test(m[2]);
  return (
    <li className="flex items-baseline justify-between gap-4 text-[12px] leading-5">
      <span className="text-ink-3">{m[1]}</span>
      <span className={numeric ? "tabular text-ink-2" : "text-ink-2"}>{m[2]}</span>
    </li>
  );
}

function Details({ preview }: { preview: WritePreview }) {
  if (!preview.details || preview.details.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {preview.details.map((line, j) => (
        <DetailLine key={j} text={line} />
      ))}
    </ul>
  );
}

const primaryBtn =
  "rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50";
const ghostBtn =
  "rounded-[var(--radius-sm)] border border-hair-2 px-3 py-1 text-[12px] font-medium text-ink-2 hover:border-crit/40 hover:text-crit disabled:opacity-50";

export function ApprovalCard({
  previews,
  calls,
  busy,
  onSubmit,
  onCancel,
  resolved,
}: ApprovalCardProps) {
  // Every row starts INCLUDED — the advisor asked for these. (Hooks run
  // unconditionally; the receipt branch below only changes what we render.)
  const [included, setIncluded] = useState<boolean[]>(() => previews.map(() => true));

  const decisions = useMemo<Record<string, Verdict>>(() => {
    const map: Record<string, Verdict> = {};
    calls.forEach((call, i) => {
      map[call.id] = included[i] ? "confirm" : "reject";
    });
    return map;
  }, [calls, included]);

  const includedCount = included.filter(Boolean).length;

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

  const cardShell = "rounded-[var(--radius)] border border-hair-2 bg-card";

  // ── Single change: the summary is the title; two controls. ──
  if (previews.length === 1) {
    const preview = previews[0];
    return (
      <div className={cardShell}>
        <div className="px-4 py-3">
          <p className="text-[13px] font-semibold text-ink">{preview.summary}</p>
          <Details preview={preview} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-hair px-4 py-3">
          <button type="button" disabled={busy} onClick={() => submitAll("reject")} className={ghostBtn}>
            Reject
          </button>
          <button type="button" disabled={busy} onClick={() => submitAll("confirm")} className={primaryBtn}>
            Approve
          </button>
        </div>
      </div>
    );
  }

  // ── Several changes: all included; untick to leave one out; one primary. ──
  const approveLabel =
    includedCount === previews.length
      ? `Approve all ${previews.length}`
      : `Approve ${includedCount} of ${previews.length}`;

  return (
    <div className={cardShell}>
      <div className="border-b border-hair px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">{batchTitle(previews)}</span>
      </div>

      <div className="divide-y divide-hair">
        {previews.map((preview, i) => {
          const on = included[i] ?? true;
          return (
            <label
              key={i}
              className={[
                "flex cursor-pointer items-start gap-3 px-4 py-3 transition-opacity",
                on ? "" : "opacity-50",
              ].join(" ")}
            >
              <input
                type="checkbox"
                aria-label={`Include: ${preview.summary}`}
                checked={on}
                disabled={busy}
                onChange={(e) =>
                  setIncluded((prev) => prev.map((cur, idx) => (idx === i ? e.target.checked : cur)))
                }
                className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{preview.summary}</p>
                <Details preview={preview} />
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-hair px-4 py-3">
        {/* The decline path, named for what it does: it resumes the graph with
            an all-reject verdict. */}
        <button type="button" onClick={onCancel} disabled={busy} className={ghostBtn}>
          Decline all
        </button>
        {/* Gated on includedCount: with nothing included this would submit a
            decline while looking like the affirmative action. */}
        <button
          type="button"
          aria-label={approveLabel}
          disabled={busy || includedCount === 0}
          onClick={() => onSubmit(decisions)}
          className={primaryBtn}
        >
          {approveLabel}
        </button>
      </div>
    </div>
  );
}
