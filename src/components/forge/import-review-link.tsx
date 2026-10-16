// src/components/forge/import-review-link.tsx
"use client";

interface ImportReviewLinkProps {
  /** The screen the import is reviewed on (`importScreenPath`). */
  href: string;
  /** Non-fatal orchestration warnings (e.g. partial extraction). */
  warnings?: string[];
}

/**
 * Compact commit affordance shown after an in-chat import: the one-click
 * hand-off to the screen the import is reviewed on — the Review Wizard for a
 * classic attach, the fact finder for a plan build — plus any non-fatal
 * warnings worth surfacing inline.
 */
export function ImportReviewLink({ href, warnings = [] }: ImportReviewLinkProps) {
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
        Review &amp; apply →
      </a>
    </div>
  );
}
