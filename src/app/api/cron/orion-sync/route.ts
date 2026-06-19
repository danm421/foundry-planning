import { NextResponse, type NextRequest } from "next/server";
import { listConnectedFirmIds } from "@/lib/orion/connections";
import { syncFirm } from "@/lib/orion/sync";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/orion-sync — nightly Vercel Cron (vercel.ts, 0 7 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). System job: operates
 * across ALL connected firms by design, so it does not go through per-user
 * org scoping. Per-firm failures are isolated so one bad firm never aborts
 * the whole run. syncFirm defaults userId to "system:orion-sync" when
 * no userId is passed.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const firmIds = await listConnectedFirmIds();
  let failed = 0;
  for (const firmId of firmIds) {
    try {
      await syncFirm(firmId, { trigger: "cron" });
    } catch (err) {
      failed += 1;
      console.error(`[orion-sync] firm ${firmId} failed`, err);
    }
  }
  return NextResponse.json({ firms: firmIds.length, failed });
}
