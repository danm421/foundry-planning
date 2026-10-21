import { type NextRequest, NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { clients, planSettings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { currentPlanningYear } from "@/lib/plan-year";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/roll-plan-start-year — daily Vercel Cron (vercel.ts, 10 5 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). System job: operates
 * across ALL firms by design, so it does not go through per-user org scoping.
 *
 * The January move: every plan whose start year is behind this planning year
 * (US Eastern) starts this year instead. A plan that was on "start next year"
 * is now on this year, so the Assumptions switch reads off. Daily rather than
 * on January 1 alone, so a missed run heals the next day; every other day it
 * finds nothing. Touches no gifts or owners — a gift dated last year that was
 * not entered as history is applied by the engine from the start.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const thisYear = currentPlanningYear();
  const stale = await db
    .select({
      id: planSettings.id,
      clientId: planSettings.clientId,
      firmId: clients.firmId,
      planStartYear: planSettings.planStartYear,
    })
    .from(planSettings)
    .innerJoin(clients, eq(clients.id, planSettings.clientId))
    .where(lt(planSettings.planStartYear, thisYear));

  let moved = 0;
  for (const row of stale) {
    try {
      await db
        .update(planSettings)
        .set({ planStartYear: thisYear, updatedAt: new Date() })
        .where(and(eq(planSettings.id, row.id), lt(planSettings.planStartYear, thisYear)));
      await recordAudit({
        action: "plan_settings.start_year_roll",
        resourceType: "plan_settings",
        resourceId: row.id,
        clientId: row.clientId,
        firmId: row.firmId,
        actorId: "system:roll-plan-start-year",
        actorKind: "system",
        metadata: { from: row.planStartYear, to: thisYear },
      });
      moved += 1;
    } catch (err) {
      console.error("[roll-plan-start-year] failed for", row.id, err);
    }
  }

  return NextResponse.json({ moved, thisYear });
}
