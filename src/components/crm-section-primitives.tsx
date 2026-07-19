import type { ReactNode } from "react";

// Shared class strings + empty-state primitive for the CRM household detail
// sections (Contacts tab, Overview tab, Related-households section). Kept
// byte-identical to what each section hand-rolled before this was extracted
// so rendering is unchanged.

/** Hairline pill — descriptive relationship/status label. Accent is reserved
 *  for action + identity status, never for descriptive data. */
export const chipClass =
  "rounded-full border border-hair-2 bg-card-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3";

export const sectionHeadingClass =
  "text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3";

export const addGhostClass =
  "rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink";

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-8 text-center">
      <p className="text-[13px] text-ink-3">{children}</p>
    </div>
  );
}
