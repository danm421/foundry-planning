import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountHoldings } from "@/db/schema";
import { snapshotInvestmentValues } from "@/lib/investments/value-snapshots";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/snapshot-portal-investments — daily Vercel Cron (vercel.ts).
 * Scheduled AFTER refresh-holding-prices (0 9) so snapshots reflect the day's
 * refreshed prices. Snapshots Σ holdingMarketValue for every account that has
 * holdings, across all firms (system job — no per-user scoping).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .selectDistinct({ accountId: accountHoldings.accountId })
    .from(accountHoldings);
  const accountIds = rows.map((r) => r.accountId);
  const asOfDate = new Date().toISOString().slice(0, 10);
  const written = await snapshotInvestmentValues(accountIds, asOfDate);
  return NextResponse.json({ ok: true, accounts: accountIds.length, written });
}
