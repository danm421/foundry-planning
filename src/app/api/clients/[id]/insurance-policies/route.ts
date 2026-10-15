import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  createInsurancePolicyForClient,
  getBaseCaseScenarioId,
} from "@/lib/clients/insurance-policies-writes";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/insurance-policies
// Lists all life-insurance policies for the client's base-case scenario
// as `{ account, policy }` pairs. Filters by category in SQL so we don't
// ship unrelated account rows back to the client.
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

    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.scenarioId, scenarioId),
          eq(accounts.category, "life_insurance"),
        ),
      );

    const policyMap = await loadPoliciesByAccountIds(accountRows.map((a) => a.id));

    const shaped = accountRows.map((account) => ({
      account,
      policy: policyMap[account.id] ?? null,
    }));

    return NextResponse.json({ policies: shaped });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/insurance-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/insurance-policies
// Creates a life-insurance account + policy + (optional) free-form
// cash-value schedule in a single transaction so a partial write can't
// leave a policy orphaned from its account — createInsurancePolicyForClient.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // The core repeats this lookup; here it answers before the body is read.
    if (!(await getBaseCaseScenarioId(id))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const result = await createInsurancePolicyForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/insurance-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
