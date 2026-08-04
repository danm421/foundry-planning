// src/app/api/cron/notification-digest/route.ts
//
// GET /api/cron/notification-digest -- daily Vercel Cron (vercel.ts, 0 9 * * *).
//
// Auth: Bearer CRON_SECRET. System job across ALL firms.
//
// 0 9 * * * is 4:00am EST. NOTE: Vercel crons do not observe DST, so this is
// 5:00am EDT for the ~8 months the US is on daylight time. Deliberate: a fixed
// UTC hour was chosen over a per-user timezone column (see the spec's decision
// 5 and future-work/ui.md).
//
// One email per advisor, covering everything pending. ZERO pending rows means
// NO email — a daily "nothing happened" message is how a sender gets filtered.
import { type NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull, inArray } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import {
  planDigestBatches,
  renderDigestEmail,
  MAX_ROWS_PER_EMAIL,
  type PendingRow,
} from "@/lib/notifications/digest";
import { sendDigestEmail } from "@/lib/notifications/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ROWS_PER_RUN = 5000;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com"
  ).replace(/\/+$/, "");

  const pending = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      category: notifications.category,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(eq(notifications.emailPending, true), isNull(notifications.emailedAt)),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(MAX_ROWS_PER_RUN);

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, usersEmailed: 0, rowsEmailed: 0, usersFailed: 0 });
  }

  // There is no local users table — email and display name live in Clerk.
  // Batched lookups, not one call per advisor. Clerk caps the userId filter
  // at 100 per call (UserApi.d.ts), so page rather than sending them all at
  // once -- unpaged, a night with >100 distinct advisors 422s the whole run.
  const CLERK_USER_ID_PAGE = 100;
  const userIds = Array.from(new Set(pending.map((r) => r.userId)));
  const cc = await clerkClient();
  const identity = new Map<string, { email: string; displayName: string | null }>();
  for (let i = 0; i < userIds.length; i += CLERK_USER_ID_PAGE) {
    const page = userIds.slice(i, i + CLERK_USER_ID_PAGE);
    const { data: users } = await cc.users.getUserList({ userId: page, limit: page.length });
    for (const u of users) {
      identity.set(u.id, {
        email: u.primaryEmailAddress?.emailAddress ?? "",
        displayName: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      });
    }
  }

  const rows: PendingRow[] = pending.map((r) => ({
    ...r,
    email: identity.get(r.userId)?.email ?? "",
    displayName: identity.get(r.userId)?.displayName ?? null,
  }));

  // No deliverable address — a deleted Clerk user, or one with no primary email.
  // planDigestBatches drops these, so without this they stay emailPending forever
  // and, being the oldest, consume the front of MAX_ROWS_PER_RUN on every later
  // run. Clear the flag but leave emailedAt NULL. The in-app row is unaffected.
  const undeliverableIds = rows.filter((r) => !r.email).map((r) => r.id);
  if (undeliverableIds.length > 0) {
    await db
      .update(notifications)
      .set({ emailPending: false })
      .where(inArray(notifications.id, undeliverableIds));
  }

  let usersEmailed = 0;
  let rowsEmailed = 0;
  let usersFailed = 0;

  for (const batch of planDigestBatches(rows, MAX_ROWS_PER_EMAIL)) {
    const { subject, html } = renderDigestEmail(batch, origin);
    const { delivered } = await sendDigestEmail({ to: batch.email, subject, html });

    if (!delivered) {
      // Leave this advisor's rows untouched for tomorrow's run, and do not let
      // one failure block anybody else.
      usersFailed++;
      continue;
    }

    // Stamp only AFTER the send succeeds, and stamp ALL of them — including the
    // rows past the render cap, which the "and N more" link covers.
    await db
      .update(notifications)
      .set({ emailPending: false, emailedAt: new Date() })
      .where(inArray(notifications.id, batch.allIds));

    usersEmailed++;
    rowsEmailed += batch.allIds.length;
  }

  return NextResponse.json({
    ok: true,
    usersEmailed,
    rowsEmailed,
    usersFailed,
    rowsUndeliverable: undeliverableIds.length,
  });
}
