import Link from "next/link";
import type { ReactElement } from "react";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { listNotifications } from "@/lib/notifications/queries";
import { isNotificationFilter, type NotificationFilter } from "@/lib/notifications/catalog";
import InboxList from "@/components/notifications/inbox-list";
import FilterChips from "@/components/notifications/filter-chips";
import { markAllReadAction } from "./actions";

const TAB_BASE = "border-b-2 pb-2 text-[14px] transition-colors";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; tab?: string }>;
}): Promise<ReactElement> {
  const { orgId, userId } = await requireOrgAndUser();
  const params = await searchParams;

  const filter: NotificationFilter = isNotificationFilter(params.filter)
    ? params.filter
    : "all";
  const rows = await listNotifications(orgId, userId, filter);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Alerts
        </h1>
        <p className="mt-1 text-[14px] text-ink-3">
          What happened across your book, and what reaches your inbox.
        </p>
      </div>

      <nav aria-label="Alerts views" className="mb-6 flex gap-5 border-b border-hair">
        <span aria-current="page" className={`${TAB_BASE} border-accent font-medium text-ink`}>
          Inbox
        </span>
        <Link
          href="/alerts?tab=settings"
          className={`${TAB_BASE} border-transparent text-ink-3 hover:text-ink`}
        >
          Settings
        </Link>
      </nav>

      <div className="mb-4 flex items-center justify-between gap-4">
        <FilterChips active={filter} />
        <form action={markAllReadAction}>
          <button
            type="submit"
            className="rounded-[var(--radius-sm)] text-[13px] font-medium text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Mark all read
          </button>
        </form>
      </div>

      <InboxList rows={rows} />
    </div>
  );
}
