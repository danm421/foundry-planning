import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cmaSets } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { CMA_SET_KEYS, type CmaSetKey, mirrorActiveSetToAssetClasses } from "@/lib/cma-sets";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { key } = (await req.json()) as { key?: string };
    if (!key || !(CMA_SET_KEYS as readonly string[]).includes(key)) {
      return NextResponse.json({ error: "Invalid set key" }, { status: 400 });
    }

    const [target] = await db
      .select()
      .from(cmaSets)
      .where(and(eq(cmaSets.firmId, firmId), eq(cmaSets.key, key as CmaSetKey)));
    if (!target) return NextResponse.json({ error: "Set not found" }, { status: 404 });

    await db.transaction(async (tx) => {
      // Clear the old active first (partial unique index forbids two active rows).
      await tx
        .update(cmaSets)
        .set({ isActive: false })
        .where(and(eq(cmaSets.firmId, firmId), ne(cmaSets.id, target.id)));
      await tx.update(cmaSets).set({ isActive: true }).where(eq(cmaSets.id, target.id));
      await mirrorActiveSetToAssetClasses(tx, firmId);
    });

    await recordAudit({
      action: "cma.set.activate",
      resourceType: "cma.set",
      resourceId: target.id,
      firmId,
      metadata: { key },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/sets/active error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
