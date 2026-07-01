import { NextResponse } from "next/server";
import { db } from "@/db";
import { assetClassCorrelations, assetClasses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const firmId = await requireOrgId();
    const rows = await db
      .select({
        assetClassIdA: assetClassCorrelations.assetClassIdA,
        assetClassIdB: assetClassCorrelations.assetClassIdB,
        correlation: assetClassCorrelations.correlation,
      })
      .from(assetClassCorrelations)
      .innerJoin(assetClasses, eq(assetClassCorrelations.assetClassIdA, assetClasses.id))
      .where(eq(assetClasses.firmId, firmId));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/correlations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
