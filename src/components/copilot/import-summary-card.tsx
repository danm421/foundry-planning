// src/components/copilot/import-summary-card.tsx
"use client";

import type { ImportSummary } from "./use-copilot-import";

interface ImportSummaryCardProps {
  clientId: string;
  importId: string;
  summary: ImportSummary;
  warnings: string[];
}

export function ImportSummaryCard({
  clientId,
  importId,
  summary,
  warnings,
}: ImportSummaryCardProps) {
  const { extract, match } = summary;
  const reviewHref = `/clients/${clientId}/details/import/${importId}`;
  return (
    <div
      data-testid="copilot-import-summary"
      className="rounded-[var(--radius)] border border-hair bg-card-2 px-3 py-2"
    >
      <p className="text-[13px] font-medium text-ink">Document processed</p>
      <p className="mt-1 text-[12px] text-ink-2">
        Extracted from {extract.succeeded} file{extract.succeeded === 1 ? "" : "s"}
        {extract.failed > 0 ? ` (${extract.failed} failed)` : ""}.
      </p>
      <p className="mt-0.5 text-[12px] text-ink-2">
        {match.exact} matched existing · {match.new} new
        {match.fuzzy > 0 ? ` · ${match.fuzzy} need review` : ""}
      </p>
      {warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[11px] text-ink-3">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <a
        href={reviewHref}
        className="mt-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-secondary px-2.5 py-1 text-[12px] font-medium text-secondary-on hover:bg-secondary-ink"
      >
        Review &amp; commit →
      </a>
    </div>
  );
}
