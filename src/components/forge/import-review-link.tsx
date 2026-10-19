// src/components/forge/import-review-link.tsx
"use client";

interface ImportReviewLinkProps {
  /** The screen the import is reviewed on (`importScreenPath`). */
  href: string;
  /** A plan build: its documents are read on the fact finder screen, so there is nothing to apply yet. */
  factFinder?: boolean;
  /** Non-fatal orchestration warnings (e.g. partial extraction). */
  warnings?: string[];
}

/**
 * The one-click hand-off after an in-chat import to the screen it is reviewed
 * on — "Review & apply" in the Review Wizard for a classic attach, "Open the
 * fact finder" for a plan build — plus any non-fatal warnings worth surfacing
 * inline.
 */
export function ImportReviewLink({ href, factFinder = false, warnings = [] }: ImportReviewLinkProps) {
  return (
    <div data-testid="forge-import-review" className="space-y-1">
      {warnings.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-ink-3">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <a
        href={href}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-secondary px-2.5 py-1 text-[12px] font-medium text-secondary-on hover:bg-secondary-ink"
      >
        {factFinder ? "Open the fact finder →" : "Review & apply →"}
      </a>
    </div>
  );
}
