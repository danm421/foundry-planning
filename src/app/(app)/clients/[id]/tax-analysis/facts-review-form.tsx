"use client";

// Placeholder for Task 14 — real fact-review form (bracket-aware editing of
// extracted return facts, save/mark-ready). Keeps Task 13's state machine
// independently testable ahead of that work.
import type { YearDetail } from "./tax-analysis-content";

export function FactsReviewForm({
  clientId,
  detail,
  onSaved,
}: {
  clientId: string;
  detail: YearDetail;
  onSaved: () => void;
}) {
  // Task 14 wires these into the real review form (bracket-aware fact
  // editing, save/mark-ready). Referenced here only to keep the exact prop
  // signature lint-clean ahead of that work.
  void clientId;
  void onSaved;
  return (
    <div className="rounded border border-hair bg-card p-6 text-ink-2">
      Review {detail.taxYear}
    </div>
  );
}
