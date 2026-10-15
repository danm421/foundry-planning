import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, accounts, stockOptionAccounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { createStockOptionAccountForClient } from "@/lib/clients/stock-options-writes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/stock-option-accounts
// Lists all stock-option accounts for the client's base-case scenario,
// joined to their extension row.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        account: accounts,
        extension: stockOptionAccounts,
      })
      .from(accounts)
      .leftJoin(stockOptionAccounts, eq(stockOptionAccounts.accountId, accounts.id))
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.scenarioId, scenarioId),
          eq(accounts.category, "stock_options"),
        ),
      );

    return NextResponse.json({ stockOptionAccounts: rows });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/stock-option-accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/stock-option-accounts
// Creates an accounts row + accountOwners row + stockOptionAccounts extension
// row in one transaction so a partial write can't leave a dangling account.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const result = await createStockOptionAccountForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json({ id: result.data.id }, { status: 201 })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/stock-option-accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
