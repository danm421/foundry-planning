import type { ReactElement, ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  /** Optional right-aligned slot on the title row (status pill, toggle, action). */
  action?: ReactNode;
  /** Optional helper line shown under the title. */
  description?: ReactNode;
  children?: ReactNode;
}

/**
 * Section card for the advisor "Manage Portal" page. Icon + title on the left,
 * an optional action/status slot on the right, optional helper line, then body.
 * Keeps all portal sections structurally identical so the page reads as one set.
 *
 * Pure presentational (no hooks / server-only imports) so it can be rendered
 * from both server and client components.
 */
export default function PortalCard({
  icon,
  title,
  action,
  description,
  children,
}: Props): ReactElement {
  return (
    <section className="card p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-ink-3">{icon}</span>
          <h3 className="text-[15px] font-medium text-ink">{title}</h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {description ? (
        <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-ink-3">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium transition disabled:opacity-50";

/** Shared button treatments — compact admin density, matching sibling portal pages. */
export const portalBtn = {
  /** Solid verdigris — the primary action on a card. */
  primary: `${BTN_BASE} bg-accent text-accent-on hover:bg-accent-ink`,
  /** Tinted verdigris outline — a benign secondary CTA (e.g. open preview). */
  accent: `${BTN_BASE} border border-accent bg-accent/15 text-accent hover:bg-accent/25`,
  /** Neutral hairline — quiet secondary action. */
  ghost: `${BTN_BASE} border border-hair text-ink-2 hover:border-hair-2 hover:text-ink`,
  /** Destructive — disable / revoke. */
  danger: `${BTN_BASE} border border-crit/40 text-crit hover:border-crit hover:bg-crit/10`,
} as const;

/** Shared text-input treatment for the portal page. */
export const portalInput =
  "w-full rounded-md border border-hair bg-paper px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent";
