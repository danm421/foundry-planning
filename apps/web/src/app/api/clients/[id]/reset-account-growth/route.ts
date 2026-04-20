import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, accounts } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

// POST /api/clients/[id]/reset-account-growth
// Resets all investable accounts (taxable/cash/retirement) for the base-case
// scenario to growth_source='default' and clears any custom portfolio / rate /
// realization overrides so they inherit the category defaults from plan_settings.
// Non-investable accounts (real estate, business, life insurance) use a flat
// growth rate that isn't controlled by this form, so we don't touch them.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
    if (!scenario) {
      return NextResponse.json({ error: "No base case scenario found" }, { status: 404 });
    }

    const result = await db
      .update(accounts)
      .set({
        growthSource: "default",
        modelPortfolioId: null,
        growthRate: null,
        turnoverPct: "0",
        overridePctOi: null,
        overridePctLtCg: null,
        overridePctQdiv: null,
        overridePctTaxExempt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.scenarioId, scenario.id),
          inArray(accounts.category, ["taxable", "cash", "retirement"])
        )
      )
      .returning({ id: accounts.id });

    return NextResponse.json({ resetCount: result.length });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/reset-account-growth error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
