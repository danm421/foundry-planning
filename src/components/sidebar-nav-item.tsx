import Link from "next/link";
import type { MouseEvent, ReactElement, ReactNode } from "react";

interface SidebarNavItemProps {
  icon: ReactNode;
  label: string;
  href?: string;
  count?: number;
  placeholder?: boolean;
  active: boolean;
  collapsed?: boolean;
  /** Fired on link click. Used by the parent nav to auto-collapse the
   *  sidebar when the user picks an item while it's expanded. */
  onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

export default function SidebarNavItem({
  icon,
  label,
  href,
  count,
  placeholder = false,
  active,
  collapsed = false,
  onNavigate,
}: SidebarNavItemProps): ReactElement {
  const rowBase = "flex items-center text-[13px] transition-colors";
  // Collapsed rail: the hit target is a compact square centred in the 64px rail
  // rather than the full-width row, so a click has to land near the icon
  // instead of anywhere in the column. Expanded rows stay full-width — the
  // label already makes the target obvious there.
  const rowShape = collapsed
    ? "mx-auto h-8 w-8 justify-center rounded"
    : "gap-3 px-[var(--pad-card)] py-2";

  if (placeholder) {
    return (
      <div
        className={`${rowBase} ${rowShape} text-ink-4 cursor-default`}
        title={collapsed ? `${label} (Soon)` : undefined}
        aria-label={collapsed ? `${label} (coming soon)` : undefined}
      >
        <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
        {collapsed ? null : (
          <>
            <span className="flex-1 truncate">{label}</span>
            <span className="rounded-sm bg-hair px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-4">
              Soon
            </span>
          </>
        )}
      </div>
    );
  }

  const stateClass = active
    ? "bg-card text-ink"
    : "text-ink-2 hover:bg-card-hover hover:text-ink";

  // The accent bar anchors to the row, not the link, so it stays pinned to the
  // rail's left edge once the collapsed link shrinks to a centred square.
  return (
    <div className="relative">
      {active ? (
        <span
          data-testid="active-bar"
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-accent"
        />
      ) : null}
      <Link
        href={href ?? "#"}
        onClick={onNavigate}
        className={`${rowBase} ${rowShape} ${stateClass}`}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
      >
        <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
        {collapsed ? null : (
          <>
            <span className="flex-1 truncate">{label}</span>
            {typeof count === "number" ? (
              <span className="text-xs text-ink-4">{count}</span>
            ) : null}
          </>
        )}
      </Link>
    </div>
  );
}
