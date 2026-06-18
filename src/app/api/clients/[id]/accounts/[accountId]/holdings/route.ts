import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountHoldings, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { holdingCreateSchema } from "@/lib/schemas/holdings";
import { recordAudit } from "@/lib/audit";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  enrichHoldingRows,
  loadEnrichedHoldings,
  type EnrichedHoldingRow,
  type RawHoldingRow,
} from "@/lib/investments/load-enriched-holdings";

// Re-exported for backward-compat with __tests__/route-enriched.test.ts
export type { EnrichedHoldingRow, RawHoldingRow };
export { enrichHoldingRows };

export const dynamic = "force-dynamic";

async function assertAccountInFirm(clientId: string, accountId: string) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  return acct ?? null;
}

// GET — list all holdings for this account, ordered by sortOrder then createdAt
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const { id, accountId } = await params;

    const acct = await assertAccountInFirm(id, accountId);
    if (!acct) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const byAccount = await loadEnrichedHoldings([accountId]);
    return NextResponse.json(byAccount.get(accountId) ?? []);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts/[accountId]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — create a single holding on this account
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const { id, accountId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const acct = await assertAccountInFirm(id, accountId);
    if (!acct) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = await parseBody(holdingCreateSchema, req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const [row] = await db
      .insert(accountHoldings)
      .values({
        accountId,
        securityId: b.securityId ?? null,
        displayTicker: b.displayTicker ?? null,
        displayName: b.displayName ?? null,
        shares: String(b.shares),
        price: String(b.price),
        priceAsOf: b.priceAsOf ?? null,
        costBasis: String(b.costBasis),
        marketValue: b.marketValue != null ? String(b.marketValue) : null,
        sortOrder: b.sortOrder ?? 0,
        notes: b.notes ?? null,
      })
      .returning();

    await recordAudit({
      action: "account.holding.create",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { holdingId: row.id, ticker: b.displayTicker ?? null }),
    });

    await syncAccountFromHoldings(accountId);

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
