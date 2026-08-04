import Link from "next/link";
import type { ReactElement } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { listNotifications } from "@/lib/notifications/queries";
import {
  isNotificationFilter,
  DEFAULT_DATE_DIGEST_CADENCE,
  type NotificationFilter,
} from "@/lib/notifications/catalog";
import { mergePrefs } from "@/lib/notifications/prefs";
import InboxList from "@/components/notifications/inbox-list";
import FilterChips from "@/components/notifications/filter-chips";
import SettingsForm from "@/components/notifications/settings-form";
import { markAllReadAction } from "./actions";

const TAB_BASE = "border-b-2 pb-2 text-[14px] transition-colors";
const TAB_ACTIVE = `${TAB_BASE} border-accent font-medium text-ink`;
const TAB_IDLE = `${TAB_BASE} border-transparent text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`;

/**
 * Tab links carry the active filter, so leaving for Settings and coming back
 * does not silently reset it. The chips need no matching treatment: they render
 * only inside the inbox branch, so there is no `tab=settings` for them to drop.
 */
function tabHref(tab: "inbox" | "settings", filter: NotificationFilter): string {
  const params = new URLSearchParams();
  if (tab === "settings") params.set("tab", "settings");
  if (filter !== "all") params.set("filter", filter);
  const qs = params.toString();
  return qs ? `/alerts?${qs}` : "/alerts";
}

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
  const isSettings = params.tab === "settings";

  // Each tab loads only what it renders — neither query runs for the other.
  const [prefRow] = isSettings
    ? await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.firmId, orgId),
            eq(notificationPreferences.userId, userId),
          ),
        )
        .limit(1)
    : [];
  const rows = isSettings ? [] : await listNotifications(orgId, userId, filter);

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
        {isSettings ? (
          <Link href={tabHref("inbox", filter)} className={TAB_IDLE}>
            Inbox
          </Link>
        ) : (
          <span aria-current="page" className={TAB_ACTIVE}>
            Inbox
          </span>
        )}
        {isSettings ? (
          <span aria-current="page" className={TAB_ACTIVE}>
            Settings
          </span>
        ) : (
          <Link href={tabHref("settings", filter)} className={TAB_IDLE}>
            Settings
          </Link>
        )}
      </nav>

      {isSettings ? (
        <SettingsForm
          prefs={mergePrefs(prefRow?.channels ?? null)}
          cadence={prefRow?.dateDigestCadence ?? DEFAULT_DATE_DIGEST_CADENCE}
        />
      ) : (
        <>
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

          <InboxList rows={rows} filtered={filter !== "all"} />
        </>
      )}
    </div>
  );
}
