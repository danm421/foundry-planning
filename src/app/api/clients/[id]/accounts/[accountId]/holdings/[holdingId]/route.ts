import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountHoldings, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { holdingUpdateSchema } from "@/lib/schemas/holdings";
import { recordAudit } from "@/lib/audit";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function assertHoldingInFirm(
  clientId: string,
  accountId: string,
  holdingId: string,
) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;
  const [row] = await db
    .select({ id: accountHoldings.id })
    .from(accountHoldings)
    .innerJoin(accounts, eq(accounts.id, accountHoldings.accountId))
    .where(
      and(
        eq(accountHoldings.id, holdingId),
        eq(accountHoldings.accountId, accountId),
        eq(accounts.clientId, clientId),
      ),
    );
  return row ?? null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; holdingId: string }> },
) {
  try {
    const { id, accountId, holdingId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await assertHoldingInFirm(id, accountId, holdingId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = await parseBody(holdingUpdateSchema, req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.securityId !== undefined) patch.securityId = b.securityId ?? null;
    if (b.displayTicker !== undefined) patch.displayTicker = b.displayTicker ?? null;
    if (b.displayName !== undefined) patch.displayName = b.displayName ?? null;
    if (b.shares !== undefined) patch.shares = String(b.shares);
    if (b.price !== undefined) patch.price = String(b.price);
    if (b.priceAsOf !== undefined) patch.priceAsOf = b.priceAsOf ?? null;
    if (b.costBasis !== undefined) patch.costBasis = String(b.costBasis);
    if (b.marketValue !== undefined) patch.marketValue = b.marketValue != null ? String(b.marketValue) : null;
    if (b.sortOrder !== undefined) patch.sortOrder = b.sortOrder;
    if (b.notes !== undefined) patch.notes = b.notes ?? null;

    const [row] = await db
      .update(accountHoldings)
      .set(patch)
      .where(eq(accountHoldings.id, holdingId))
      .returning();

    await recordAudit({
      action: "account.holding.update",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { holdingId }),
    });

    await syncAccountFromHoldings(accountId);

    return NextResponse.json(row);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT holding error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; holdingId: string }> },
) {
  try {
    const { id, accountId, holdingId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await assertHoldingInFirm(id, accountId, holdingId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.delete(accountHoldings).where(eq(accountHoldings.id, holdingId));

    await recordAudit({
      action: "account.holding.delete",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { holdingId }),
    });

    await syncAccountFromHoldings(accountId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE holding error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
