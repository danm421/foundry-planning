"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications/queries";

// The sidebar's unread badge is rendered by `src/app/(app)/layout.tsx`, which
// survives client-side navigation — so refreshing only the /alerts *page*
// segment would leave a stale count sitting next to a list that just went
// read. `type: "layout"` is the documented form that covers the layout
// rendering this path plus the pages beneath it (see the revalidatePath API
// reference in node_modules/next/dist/docs). Today the bare `revalidatePath("/alerts")`
// would also work, but only by accident: Next 16.2.10 sets `pathWasRevalidated`
// for *any* revalidate call (`// TODO: only revalidate if the path matches`)
// and always renders the action's flight from the root (`// TODO: Currently the
// server always renders from the root`). Both are marked TODO upstream; naming
// the layout states the requirement so it survives them being resolved.
export async function markReadAction(id: string): Promise<void> {
  const { orgId, userId } = await requireOrgAndUser();
  await markNotificationRead(orgId, userId, id);
  revalidatePath("/alerts", "layout");
}

export async function markAllReadAction(): Promise<void> {
  const { orgId, userId } = await requireOrgAndUser();
  await markAllNotificationsRead(orgId, userId);
  revalidatePath("/alerts", "layout");
}
