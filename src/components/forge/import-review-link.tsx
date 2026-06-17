// src/components/copilot/import-review-link.tsx
"use client";

interface ImportReviewLinkProps {
  clientId: string;
  importId: string;
  /** Non-fatal orchestration warnings (e.g. partial extraction). */
  warnings: string[];
}

/**
 * Compact commit affordance shown after an in-chat import. The agent narrates
 * what it found; this is the one-click hand-off to the existing review wizard,
 * plus any non-fatal warnings worth surfacing inline.
 */
export function ImportReviewLink({ clientId, importId, warnings }: ImportReviewLinkProps) {
  const reviewHref = `/clients/${clientId}/details/import/${importId}`;
  return (
    <div data-testid="copilot-import-review" className="space-y-1">
      {warnings.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-ink-3">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <a
        href={reviewHref}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-secondary px-2.5 py-1 text-[12px] font-medium text-secondary-on hover:bg-secondary-ink"
      >
        Review &amp; apply →
      </a>
    </div>
  );
}
