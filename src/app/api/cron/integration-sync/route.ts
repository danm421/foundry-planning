import { NextResponse, type NextRequest } from "next/server";
import { listConnectedFirms } from "@/lib/integrations/connections";
import { getProvider } from "@/lib/integrations/registry";
import { syncFirm } from "@/lib/integrations/sync";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/integration-sync — nightly Vercel Cron (vercel.ts, 0 7 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). System job: operates
 * across ALL connected (firm, provider) pairs by design, so it does not go
 * through per-user org scoping. Pairs whose provider is currently disabled
 * (e.g. Schwab pending partner credentials) are skipped, as are pairs whose
 * provider is credentials-only (`syncs: false`, e.g. azure_openai) — it has
 * no households/accounts/positions to pull, and syncFirm throws
 * `provider_does_not_sync` for one, which would otherwise inflate `failed`
 * and log an error every night for every firm that connects it. Per-pair
 * failures are isolated so one bad firm never aborts the whole run. syncFirm
 * defaults userId to "system:<providerId>-sync" when no userId is passed.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pairs = await listConnectedFirms();
  let failed = 0;
  for (const { firmId, providerId } of pairs) {
    const provider = getProvider(providerId);
    if (!provider.isEnabled() || !provider.syncs) continue;
    try {
      await syncFirm(firmId, providerId, { trigger: "cron" });
    } catch (err) {
      failed += 1;
      console.error(`[integration-sync] firm ${firmId} (${providerId}) failed`, err);
    }
  }
  return NextResponse.json({ firms: pairs.length, failed });
}
