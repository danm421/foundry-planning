// src/lib/notifications/plan.ts
//
// Pure: (recipients + their merged prefs) -> the exact rows to insert.
// Excludes the actor, dedupes recipients, drops anyone with both channels off,
// and stamps inApp/emailPending per recipient for this category.
import type { NotificationCategory, NotificationPrefsMap } from "./catalog";
import { decideRouting } from "./prefs";

export type NotificationRecipient = { userId: string; prefs: NotificationPrefsMap };

/** Field names match the drizzle column keys on `notifications` exactly. */
export type PlannedNotificationRow = {
  firmId: string;
  userId: string;
  category: NotificationCategory;
  actorUserId: string | null;
  clientId: string | null;
  title: string;
  body: string | null;
  url: string;
  entityType: string | null;
  entityId: string | null;
  dedupKey: string | null;
  inApp: boolean;
  emailPending: boolean;
};

export type PlanNotificationsInput = {
  firmId: string;
  recipients: NotificationRecipient[];
  category: NotificationCategory;
  actorUserId: string | null;
  clientId?: string | null;
  title: string;
  body?: string | null;
  url: string;
  entityType?: string | null;
  entityId?: string | null;
  dedupKey?: string | null;
};

export function planNotificationRows(
  input: PlanNotificationsInput,
): PlannedNotificationRow[] {
  const seen = new Set<string>();
  const rows: PlannedNotificationRow[] = [];
  for (const r of input.recipients) {
    // You never get told about the thing you just did yourself.
    if (r.userId === input.actorUserId) continue;
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);

    const routing = decideRouting(r.prefs, input.category);
    // Writing a row with both channels off would inflate the inbox with rows
    // nothing ever renders and nothing ever emails.
    if (!routing.inApp && !routing.emailPending) continue;

    rows.push({
      firmId: input.firmId,
      userId: r.userId,
      category: input.category,
      actorUserId: input.actorUserId,
      clientId: input.clientId ?? null,
      title: input.title,
      body: input.body ?? null,
      url: input.url,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupKey: input.dedupKey ?? null,
      inApp: routing.inApp,
      emailPending: routing.emailPending,
    });
  }
  return rows;
}
