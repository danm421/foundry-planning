import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

interface SidebarNavItemProps {
  icon: ReactNode;
  label: string;
  href?: string;
  count?: number;
  placeholder?: boolean;
  active: boolean;
}

export default function SidebarNavItem({
  icon,
  label,
  href,
  count,
  placeholder = false,
  active,
}: SidebarNavItemProps): ReactElement {
  if (placeholder) {
    return (
      <div className="relative flex items-center gap-3 px-[var(--pad-card)] py-2 text-[13px] text-ink-4 cursor-default">
        <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        <span className="rounded-sm bg-hair px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-4">
          Soon
        </span>
      </div>
    );
  }

  const content = (
    <>
      {active ? (
        <span
          data-testid="active-bar"
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-accent"
        />
      ) : null}
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" ? (
        <span className="text-xs text-ink-4">{count}</span>
      ) : null}
    </>
  );

  const baseClass =
    "relative flex items-center gap-3 px-[var(--pad-card)] py-2 text-[13px] transition-colors";
  const stateClass = active
    ? "bg-card text-ink"
    : "text-ink-2 hover:bg-card-hover hover:text-ink";

  return (
    <Link
      href={href ?? "#"}
      className={`${baseClass} ${stateClass}`}
      aria-current={active ? "page" : undefined}
    >
      {content}
    </Link>
  );
}
