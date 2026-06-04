import { type NextRequest, NextResponse } from "next/server";
import { and, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { purgeCrmHouseholdById } from "@/lib/crm/households";
import { HOUSEHOLD_TRASH_RETENTION_DAYS } from "@/lib/crm/trash";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/purge-deleted-households — daily Vercel Cron (vercel.ts, 0 4 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). System job: operates
 * across ALL firms by design, so it does not go through per-user org scoping.
 *
 * Permanently deletes every household whose deletedAt is older than the
 * retention window. Per-household failures are logged and skipped so one bad
 * row can't abort the whole sweep.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await db
    .select({ id: crmHouseholds.id, firmId: crmHouseholds.firmId })
    .from(crmHouseholds)
    .where(
      and(
        isNotNull(crmHouseholds.deletedAt),
        lt(
          crmHouseholds.deletedAt,
          sql`now() - make_interval(days => ${HOUSEHOLD_TRASH_RETENTION_DAYS})`,
        ),
      ),
    );

  let purged = 0;
  for (const row of due) {
    try {
      await purgeCrmHouseholdById(row.id, row.firmId);
      purged += 1;
    } catch (err) {
      console.error("[purge-deleted-households] failed for", row.id, err);
    }
  }

  return NextResponse.json({ purged, candidates: due.length });
}
