import { NextResponse } from "next/server";
import { db } from "@/db";
import { cmaSets } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const firmId = await requireOrgId();
    const rows = await db
      .select()
      .from(cmaSets)
      .where(eq(cmaSets.firmId, firmId))
      .orderBy(asc(cmaSets.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/sets error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
