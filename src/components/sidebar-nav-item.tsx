import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

interface SidebarNavItemProps {
  icon: ReactNode;
  label: string;
  href?: string;
  count?: number;
  placeholder?: boolean;
  active: boolean;
  collapsed?: boolean;
}

export default function SidebarNavItem({
  icon,
  label,
  href,
  count,
  placeholder = false,
  active,
  collapsed = false,
}: SidebarNavItemProps): ReactElement {
  const rowBase = "relative flex items-center py-2 text-[13px] transition-colors";
  const rowSpacing = collapsed
    ? "justify-center px-2"
    : "gap-3 px-[var(--pad-card)]";

  if (placeholder) {
    return (
      <div
        className={`${rowBase} ${rowSpacing} text-ink-4 cursor-default`}
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

  return (
    <Link
      href={href ?? "#"}
      className={`${rowBase} ${rowSpacing} ${stateClass}`}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      {active ? (
        <span
          data-testid="active-bar"
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-accent"
        />
      ) : null}
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
  );
}
