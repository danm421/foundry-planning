"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications/queries";
import { parseSettingsPayload } from "@/lib/notifications/settings-payload";

// The sidebar's unread badge lives in `src/app/(app)/layout.tsx`, which the
// router preserves across client-side navigation, so it only updates when that
// layout re-renders. This call is what causes that: revalidating marks the
// action as having revalidated, and the router refreshes once the action queue
// drains — re-rendering the `(app)` layout along with the page. The badge
// converges through that refresh, NOT through tag invalidation. Nothing on this
// route is tag-cached today (both the page and the layout are fully dynamic).
//
// Pass the literal path with no `type`: that emits the `_N_T_/alerts` tag, which
// is in this route's implicit tag set. A `"layout"` type would emit
// `_N_T_/alerts/layout`, which matches nothing here — the route's layout tags
// retain the `(app)` route group (`_N_T_/(app)/layout`). So if you later wrap
// the badge's count in `use cache`, this call will NOT invalidate it on its own;
// give that cache an explicit tag and revalidate it here too.
export async function markReadAction(id: string): Promise<void> {
  const { orgId, userId } = await requireOrgAndUser();
  await markNotificationRead(orgId, userId, id);
  revalidatePath("/alerts");
}

export async function markAllReadAction(): Promise<void> {
  const { orgId, userId } = await requireOrgAndUser();
  await markAllNotificationsRead(orgId, userId);
  revalidatePath("/alerts");
}

// One row per (firm, advisor), so the upsert targets the
// `notification_preferences_firm_user_idx` unique index rather than the
// primary key — an advisor in two Clerk orgs keeps a row per firm.
export async function savePreferencesAction(form: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgAndUser();
  const { channels, cadence } = parseSettingsPayload(form);

  await db
    .insert(notificationPreferences)
    .values({
      firmId: orgId,
      userId,
      channels,
      dateDigestCadence: cadence,
    })
    .onConflictDoUpdate({
      target: [notificationPreferences.firmId, notificationPreferences.userId],
      set: { channels, dateDigestCadence: cadence, updatedAt: new Date() },
    });

  await recordAudit({
    action: "notification.preferences.update",
    resourceType: "notification_preferences",
    resourceId: userId,
    firmId: orgId,
    // `channels` too, not just the cadence: "when did this advisor turn email
    // on for task_mentioned?" is the one question a preferences audit exists to
    // answer, and the cadence alone cannot answer it.
    metadata: { cadence, channels },
  });

  revalidatePath("/alerts");
}

// The first-visit prompt's "No thanks". Stamped rather than a boolean so the
// row also records WHEN it was declined. Same upsert target as the save above:
// an advisor who never opened Settings has no preferences row yet, so this has
// to be able to create one. Not audited — declining a nudge is not a
// permissions- or money-relevant change, and the prompt is shown once.
export async function dismissEmailPromptAction(): Promise<void> {
  const { orgId, userId } = await requireOrgAndUser();
  const now = new Date();
  await db
    .insert(notificationPreferences)
    .values({ firmId: orgId, userId, emailPromptDismissedAt: now })
    .onConflictDoUpdate({
      target: [notificationPreferences.firmId, notificationPreferences.userId],
      set: { emailPromptDismissedAt: now, updatedAt: now },
    });
  revalidatePath("/alerts");
}
