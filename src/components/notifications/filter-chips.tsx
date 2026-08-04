import Link from "next/link";
import type { ReactElement } from "react";
// Derived from NOTIFICATION_GROUPS — never hand-list the chips, or a group
// added to the catalog silently loses its tab.
import { NOTIFICATION_FILTERS, type NotificationFilter } from "@/lib/notifications/catalog";

const CHIP_BASE =
  "rounded-full px-3 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export default function FilterChips({
  active,
}: {
  active: NotificationFilter;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      {NOTIFICATION_FILTERS.map((f) => (
        <Link
          key={f.id}
          href={`/alerts?filter=${f.id}`}
          aria-current={f.id === active ? "page" : undefined}
          className={
            f.id === active
              ? `${CHIP_BASE} bg-accent text-accent-on`
              : `${CHIP_BASE} border border-hair text-ink-3 hover:bg-card-2 hover:text-ink-2`
          }
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}
