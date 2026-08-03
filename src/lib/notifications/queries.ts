// src/lib/notifications/queries.ts
//
// Firm-scoped reads and read-state writes for the Alerts inbox.
import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import {
  GROUP_CATEGORIES,
  type NotificationCategory,
  type NotificationFilter,
} from "./catalog";

export type InboxRow = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  url: string;
  readAt: Date | null;
  createdAt: Date;
};

const DEFAULT_INBOX_LIMIT = 100;

/**
 * Categories a filter narrows to, or null for the two built-ins that do not
 * narrow by category. DERIVED from GROUP_CATEGORIES — never hand-list, or a
 * group added to the catalog silently returns an empty inbox here.
 */
export function filterCategories(
  filter: NotificationFilter,
): NotificationCategory[] | null {
  if (filter === "all" || filter === "unread") return null;
  return GROUP_CATEGORIES[filter];
}

export async function countUnreadNotifications(
  firmId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.firmId, firmId),
        eq(notifications.userId, userId),
        eq(notifications.inApp, true),
        isNull(notifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

export async function listNotifications(
  firmId: string,
  userId: string,
  filter: NotificationFilter,
  limit: number = DEFAULT_INBOX_LIMIT,
): Promise<InboxRow[]> {
  const cats = filterCategories(filter);
  return db
    .select({
      id: notifications.id,
      category: notifications.category,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.firmId, firmId),
        eq(notifications.userId, userId),
        // A row written with in_app false exists only to be emailed; it must
        // never appear in the inbox.
        eq(notifications.inApp, true),
        filter === "unread" ? isNull(notifications.readAt) : undefined,
        cats ? inArray(notifications.category, cats) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationRead(
  firmId: string,
  userId: string,
  id: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.firmId, firmId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
}

export async function markAllNotificationsRead(
  firmId: string,
  userId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.firmId, firmId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
}
