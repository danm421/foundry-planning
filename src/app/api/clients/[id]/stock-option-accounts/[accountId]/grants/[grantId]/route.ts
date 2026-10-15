import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, stockOptionGrants } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { updateStockOptionGrantForClient } from "@/lib/clients/stock-options-writes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared org-scope guard: verify client → account → grant ownership.
// Returns { firmId, grant } on success, or a NextResponse on failure.
// ---------------------------------------------------------------------------
async function resolveGrantOrError(
  id: string,
  accountId: string,
  grantId: string,
): Promise<
  | { ok: true; firmId: string; grant: typeof stockOptionGrants.$inferSelect }
  | { ok: false; response: NextResponse }
> {
  const firmId = await requireOrgId();

  const access = await verifyClientAccess(id);
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    };
  }
  if (access.permission !== "edit") {
    return {
      ok: false,
      response: NextResponse.json({ error: "View-only access" }, { status: 403 }),
    };
  }

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, id),
        eq(accounts.category, "stock_options"),
      ),
    );
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Account not found" }, { status: 404 }),
    };
  }

  const [grant] = await db
    .select()
    .from(stockOptionGrants)
    .where(
      and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)),
    );
  if (!grant) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Grant not found" }, { status: 404 }),
    };
  }

  return { ok: true, firmId, grant };
}

// ---------------------------------------------------------------------------
// PUT /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId]
// Full replacement of grant fields + tranches + planned events in one transaction.
// ---------------------------------------------------------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; grantId: string }> },
) {
  try {
    const { id, accountId, grantId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const guard = await resolveGrantOrError(id, accountId, grantId);
    if (!guard.ok) return guard.response;

    const result = await updateStockOptionGrantForClient({
      clientId: id,
      firmId,
      accountId,
      grantId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PUT /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId]
// Deletes the grant; FK cascades remove tranches + planned events.
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; grantId: string }> },
) {
  try {
    const { id, accountId, grantId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const guard = await resolveGrantOrError(id, accountId, grantId);
    if (!guard.ok) return guard.response;
    const { grant } = guard;

    await db
      .delete(stockOptionGrants)
      .where(and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)));

    await recordAudit({
      action: "account.stock_options.grant.delete",
      resourceType: "stock_option_grant",
      resourceId: grantId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { accountId, grantType: grant.grantType }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
