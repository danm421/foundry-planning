import type { ReactNode } from "react";

interface ComponentCardProps {
  title: string;
  children: ReactNode;
  /** Rendered below a hairline divider -- reserved for a computed-as-of note,
   *  not another data point. */
  footer?: ReactNode;
}

/**
 * Shared shell for the three risk-detail component cards (tolerance,
 * capacity, environment). Matches the `border-hair bg-card` chrome the Risk
 * list page (Task 8) already established, so the list and detail pages read
 * as one surface.
 */
export function ComponentCard({ title, children, footer }: ComponentCardProps) {
  return (
    <div className="flex flex-col rounded-lg border border-hair bg-card p-5 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      <div className="mt-3 flex-1 space-y-3">{children}</div>
      {footer && (
        <div className="mt-4 border-t border-hair pt-3 text-xs text-ink-3">{footer}</div>
      )}
    </div>
  );
}
