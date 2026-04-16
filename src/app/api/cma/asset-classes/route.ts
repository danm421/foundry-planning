import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export async function GET() {
  try {
    const firmId = await getOrgId();
    const rows = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId))
      .orderBy(asc(assetClasses.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/asset-classes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const firmId = await getOrgId();
    const body = await request.json();
    const { name, geometricReturn, arithmeticMean, volatility, pctOrdinaryIncome, pctLtCapitalGains, pctQualifiedDividends, pctTaxExempt, sortOrder } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(assetClasses)
      .values({
        firmId,
        name,
        geometricReturn: geometricReturn ?? "0.07",
        arithmeticMean: arithmeticMean ?? "0.085",
        volatility: volatility ?? "0.15",
        pctOrdinaryIncome: pctOrdinaryIncome ?? "0",
        pctLtCapitalGains: pctLtCapitalGains ?? "0.85",
        pctQualifiedDividends: pctQualifiedDividends ?? "0.15",
        pctTaxExempt: pctTaxExempt ?? "0",
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/cma/asset-classes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
