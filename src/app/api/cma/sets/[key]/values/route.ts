import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cmaSets, cmaSetValues, assetClasses } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { CMA_SET_KEYS, type CmaSetKey, mirrorActiveSetToAssetClasses } from "@/lib/cma-sets";
import { cmaSetValuesUpdateSchema } from "@/lib/schemas/cma-sets";
import { isLockedSystemAssetClass } from "@/lib/investments/asset-class-slugs";

export const dynamic = "force-dynamic";

function isKey(k: string): k is CmaSetKey {
  return (CMA_SET_KEYS as readonly string[]).includes(k);
}

async function loadSet(firmId: string, key: string) {
  if (!isKey(key)) return null;
  const [set] = await db
    .select()
    .from(cmaSets)
    .where(and(eq(cmaSets.firmId, firmId), eq(cmaSets.key, key)));
  return set ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const firmId = await requireOrgId();
    const { key } = await params;
    const set = await loadSet(firmId, key);
    if (!set) return NextResponse.json({ error: "Set not found" }, { status: 404 });
    const rows = await db.select().from(cmaSetValues).where(eq(cmaSetValues.cmaSetId, set.id));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/sets/[key]/values error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { key } = await params;
    const set = await loadSet(firmId, key);
    if (!set) return NextResponse.json({ error: "Set not found" }, { status: 404 });

    const parsed = cmaSetValuesUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    const firmAssetClasses = await db
      .select({ id: assetClasses.id, slug: assetClasses.slug })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    const lockedIds = new Set(
      firmAssetClasses.filter((r) => isLockedSystemAssetClass(r.slug)).map((r) => r.id),
    );
    if (parsed.data.values.some((v) => lockedIds.has(v.assetClassId))) {
      return NextResponse.json(
        { error: "Cash is a system asset class and cannot be modified." },
        { status: 403 },
      );
    }

    await db.transaction(async (tx) => {
      for (const v of parsed.data.values) {
        await tx
          .update(cmaSetValues)
          .set({
            geometricReturn: v.geometricReturn,
            arithmeticMean: v.arithmeticMean,
            volatility: v.volatility,
            updatedAt: new Date(),
          })
          .where(and(eq(cmaSetValues.cmaSetId, set.id), eq(cmaSetValues.assetClassId, v.assetClassId)));
      }
      // Mirror onto asset_classes only when editing the active set.
      if (set.isActive) await mirrorActiveSetToAssetClasses(tx, firmId);
    });

    await recordAudit({
      action: "cma.set.values.update",
      resourceType: "cma.set",
      resourceId: set.id,
      firmId,
      metadata: { key, count: parsed.data.values.length, mirrored: set.isActive },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/cma/sets/[key]/values error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
