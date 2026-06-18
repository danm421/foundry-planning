import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  accountHoldings,
  holdingAssetClassOverrides,
  assetClasses,
  accounts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { holdingOverrideSchema } from "@/lib/schemas/holdings";
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

    const parsed = await parseBody(holdingOverrideSchema, req);
    if (!parsed.ok) return parsed.response;
    const { overrides } = parsed.data;

    // Every referenced asset class must belong to this firm.
    const classIds = Array.from(new Set(overrides.map((o) => o.assetClassId)));
    if (classIds.length > 0) {
      const valid = await db
        .select({ id: assetClasses.id })
        .from(assetClasses)
        .where(eq(assetClasses.firmId, firmId));
      const validIds = new Set(valid.map((c) => c.id));
      for (const cid of classIds) {
        if (!validIds.has(cid)) {
          return NextResponse.json({ error: "Invalid asset class reference" }, { status: 400 });
        }
      }
    }

    const nonZero = overrides.filter((o) => o.weight > 0);
    await db.transaction(async (tx) => {
      await tx
        .delete(holdingAssetClassOverrides)
        .where(eq(holdingAssetClassOverrides.holdingId, holdingId));
      if (nonZero.length > 0) {
        await tx.insert(holdingAssetClassOverrides).values(
          nonZero.map((o) => ({
            holdingId,
            assetClassId: o.assetClassId,
            weight: String(o.weight),
          })),
        );
      }
    });

    await recordAudit({
      action: "account.holding.override.update",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { holdingId, count: nonZero.length }),
    });

    await syncAccountFromHoldings(accountId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT holding override error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
