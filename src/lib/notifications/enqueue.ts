// src/lib/notifications/enqueue.ts
//
// The single write chokepoint for advisor notifications. Every producer calls
// this and nothing else.
//
// CONTRACT: this function NEVER throws to its caller and MUST be called AFTER
// the business write commits, never inside its transaction. A notification
// failure must not roll back a client's intake submission. Same fire-and-forget
// shape as src/lib/intake/email.ts.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notifications, notificationPreferences } from "@/db/schema";
import { isNotificationCategory, type NotificationCategory } from "./catalog";
import { mergePrefs } from "./prefs";
import { planNotificationRows } from "./plan";

export type EnqueueInput = {
  firmId: string;
  /** Clerk user ids. Deduped and actor-filtered downstream. */
  recipients: string[];
  category: NotificationCategory;
  actorUserId: string | null;
  clientId?: string | null;
  title: string;
  body?: string | null;
  url: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Set to make the insert idempotent against the partial unique index. */
  dedupKey?: string | null;
};

export async function enqueueNotifications(input: EnqueueInput): Promise<void> {
  try {
    // The TS type says this cannot happen, but producers build categories from
    // runtime data (a webhook payload, a scanner). An unknown category would
    // write a row no filter matches and no label renders.
    if (!isNotificationCategory(input.category)) {
      console.error("[notifications] unknown category, dropping", input.category);
      return;
    }

    const ids = Array.from(new Set(input.recipients)).filter(
      (id) => id && id !== input.actorUserId,
    );
    if (ids.length === 0) return;

    const prefRows = await db
      .select({
        userId: notificationPreferences.userId,
        channels: notificationPreferences.channels,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.firmId, input.firmId),
          inArray(notificationPreferences.userId, ids),
        ),
      );

    const byUser = new Map(prefRows.map((r) => [r.userId, r.channels]));
    // Driven from `ids`, not from prefRows — an advisor with no preferences row
    // must still be notified, on the shipped defaults.
    const recipients = ids.map((userId) => ({
      userId,
      prefs: mergePrefs(byUser.get(userId) ?? null),
    }));

    const rows = planNotificationRows({ ...input, recipients });
    if (rows.length === 0) return;

    await db.insert(notifications).values(rows).onConflictDoNothing();
  } catch (err) {
    console.error(
      "[notifications] enqueue failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
