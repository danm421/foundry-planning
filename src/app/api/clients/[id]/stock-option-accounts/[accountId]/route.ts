import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { findStockOptionAccount, updateStockOptionAccountForClient } from "@/lib/clients/stock-options-writes";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/stock-option-accounts/[accountId]
// Partial update of a stock-option account (accounts row + owner + extension).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await findStockOptionAccount(id, accountId))) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const result = await updateStockOptionAccountForClient({
      clientId: id,
      firmId,
      accountId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PUT /api/clients/[id]/stock-option-accounts/[accountId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/stock-option-accounts/[accountId]
// Deletes the accounts row; FK cascades handle extension + grants/tranches/events.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // Tenant-isolation: same guard as PUT.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.clientId, id),
          eq(accounts.category, "stock_options"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

    await recordAudit({
      action: "account.stock_options.delete",
      resourceType: "stock_option_account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: target.name ?? null }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/stock-option-accounts/[accountId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
