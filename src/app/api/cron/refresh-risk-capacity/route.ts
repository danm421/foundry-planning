// src/app/api/cron/refresh-risk-capacity/route.ts
//
// GET /api/cron/refresh-risk-capacity -- nightly Vercel Cron (vercel.ts, 0 6 * * *).
//
// Auth: Bearer CRON_SECRET. System job: operates across ALL firms by design, so
// it does not go through per-user org scoping.
//
// The Risk list reads the denormalized capacity snapshot on
// client_risk_profiles. getOrComputeCapacity refreshes that snapshot whenever
// anyone opens a household, but households nobody opens would keep a stale
// score forever -- this sweep is the backstop.
import { type NextRequest, NextResponse } from "next/server";
import { isNotNull } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { clientRiskProfiles } from "@/db/schema";
import { getOrComputeCapacity } from "@/lib/risk/capacity";

export const dynamic = "force-dynamic";
// Runs a full projection per household, serially. Vercel's default function
// timeout would cut the sweep off partway once the profiled-household count
// grows, silently starving the households at the end of the list of a
// refresh. Same rationale as drain-compliance-exports (also a per-item loop
// over an unbounded set); 800s is the max Vercel allows on this plan.
export const maxDuration = 800;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      clientId: clientRiskProfiles.clientId,
      firmId: clientRiskProfiles.firmId,
    })
    .from(clientRiskProfiles)
    .where(isNotNull(clientRiskProfiles.toleranceScore));

  let refreshed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await getOrComputeCapacity({ clientId: row.clientId, firmId: row.firmId });
      refreshed++;
    } catch (err) {
      // A household with no plan, or a projection that throws, must not stop
      // the sweep for everyone behind it.
      failed++;
      Sentry.captureException(err, {
        tags: { job: "refresh-risk-capacity" },
        extra: { clientId: row.clientId },
      });
    }
  }

  return NextResponse.json({ refreshed, failed, total: rows.length });
}
