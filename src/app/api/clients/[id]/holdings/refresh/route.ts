import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { accountHoldings, accounts } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { recordAudit } from "@/lib/audit";
import { refreshHoldings } from "@/lib/investments/refresh-holdings";

export const dynamic = "force-dynamic";

/**
 * POST /api/clients/[id]/holdings/refresh — manual, on-demand price refresh for
 * ALL of a client's tickered holdings across every account/scenario. Mirrors
 * the nightly cron's pricing engine but runs through normal per-user org
 * scoping (requireOrgId + client-in-firm) instead of CRON_SECRET. Applies
 * immediately and returns a RefreshSummary.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // All tickered holdings across this client's accounts. clientId is already
    // firm-verified above, so the accounts join transitively scopes by firm.
    const holdings = await db
      .select({
        id: accountHoldings.id,
        accountId: accountHoldings.accountId,
        displayTicker: accountHoldings.displayTicker,
        priceAsOf: accountHoldings.priceAsOf,
        deriveFromHoldings: accounts.deriveFromHoldings,
      })
      .from(accountHoldings)
      .innerJoin(accounts, eq(accounts.id, accountHoldings.accountId))
      .where(
        and(
          eq(accounts.clientId, id),
          isNotNull(accountHoldings.displayTicker),
          ne(accountHoldings.displayTicker, ""),
        ),
      );

    const summary = await refreshHoldings(holdings);

    await recordAudit({
      action: "client.holdings.refresh",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        holdingsUpdated: summary.holdingsUpdated,
        tickersMissing: summary.tickersMissing,
      }),
    });

    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/holdings/refresh error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
