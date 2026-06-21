// src/app/api/cron/purge-expired-firms/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { and, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { firms, subscriptions } from "@/db/schema";
import { purgeFirmById } from "@/lib/billing/purge-firm";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/purge-expired-firms — daily Vercel Cron (vercel.ts, 0 6 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). Fail-closed: a missing
 * secret or wrong token gets 401 and never touches data. System job: operates
 * across ALL firms by design, so it does not go through per-user org scoping.
 *
 * Permanently purges every firm whose retention window has elapsed
 * (archivedAt set, dataRetentionUntil in the past, not already purged).
 * Per-firm failures are logged and skipped so one bad row can't abort the
 * whole sweep. Honors the privacy-policy deletion right.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await db
    .select({ firmId: firms.firmId })
    .from(firms)
    .where(
      and(
        isNotNull(firms.archivedAt),
        lt(firms.dataRetentionUntil, new Date()),
        isNull(firms.purgedAt),
        // Defense in depth: never even consider a firm that resubscribed.
        sql`not exists (
          select 1 from ${subscriptions}
          where ${subscriptions.firmId} = ${firms.firmId}
          and ${subscriptions.status} in ('trialing','active','past_due','unpaid')
        )`,
      ),
    );

  let purged = 0;
  for (const row of due) {
    try {
      await purgeFirmById(row.firmId);
      purged += 1;
    } catch (err) {
      console.error("[purge-expired-firms] failed for", row.firmId, err);
    }
  }

  return NextResponse.json({ purged, candidates: due.length });
}
