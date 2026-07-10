"use client";

// Placeholder for Task 14 — real client-ready tax report (bracket
// positioning, planning observations, PDF export). Keeps Task 13's state
// machine independently testable ahead of that work.
import type { YearDetail } from "./tax-analysis-content";

export function TaxReportView({
  clientId,
  detail,
  onEditFacts,
}: {
  clientId: string;
  detail: YearDetail;
  onEditFacts: () => void | Promise<void>;
}) {
  // Task 14 wires these into the real report view (bracket positioning,
  // planning observations, the "Edit facts" reopen action). Referenced here
  // only to keep the exact prop signature lint-clean ahead of that work.
  void clientId;
  void onEditFacts;
  return (
    <div className="rounded border border-hair bg-card p-6 text-ink-2">
      Report {detail.taxYear}
    </div>
  );
}
