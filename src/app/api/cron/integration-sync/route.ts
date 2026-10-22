import { NextResponse, type NextRequest } from "next/server";
import { listConnectedSyncingConnections } from "@/lib/integrations/connections";
import { getProvider } from "@/lib/integrations/registry";
import { syncConnection } from "@/lib/integrations/sync";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/integration-sync — nightly Vercel Cron (vercel.ts, 0 7 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). System job: operates
 * across ALL connected syncing connections (never azure_openai, which has
 * nothing to pull) by design, so it does not go through per-user org scoping.
 * Connections whose provider is currently disabled (e.g. Schwab pending
 * partner credentials) are skipped. Per-connection failures are isolated so
 * one bad connection never aborts the whole run. syncConnection defaults
 * userId to "system:<providerId>-sync" when no userId is passed, and files
 * every review under the connection's owner.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const connections = await listConnectedSyncingConnections();
  let failed = 0;
  for (const { id, firmId, providerId } of connections) {
    if (!getProvider(providerId).isEnabled()) continue;
    try {
      await syncConnection(id, { trigger: "cron" });
    } catch (err) {
      failed += 1;
      console.error(`[integration-sync] connection ${id} (firm ${firmId}, ${providerId}) failed`, err);
    }
  }
  return NextResponse.json({ connections: connections.length, failed });
}
