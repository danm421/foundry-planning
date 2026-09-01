import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, savingsRules, savingsRuleSalaryIncomes } from "@/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createSavingsRuleForClient } from "@/lib/clients/savings-rules-writes";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/savings-rules — list savings rules for base case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(savingsRules)
      .where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenarioId)));

    // A rule's salary basis is stored in two halves: `salaryBasis` is a column
    // on the row above, but the salaries a "selected" basis names live in a
    // join table. Returning the column alone is worse than returning neither —
    // the Savings tab seeds its panel from `salaryIncomeIds`, finds none, falls
    // back to "owner", and the next Save Changes deletes the advisor's picks.
    const ruleIds = rows.map((r) => r.id);
    const salaryIncomeRows = ruleIds.length
      ? await db
          .select()
          .from(savingsRuleSalaryIncomes)
          .where(inArray(savingsRuleSalaryIncomes.savingsRuleId, ruleIds))
          .orderBy(
            asc(savingsRuleSalaryIncomes.savingsRuleId),
            asc(savingsRuleSalaryIncomes.sortOrder),
          )
      : [];
    const salaryIncomeIdsByRuleId = new Map<string, string[]>();
    for (const r of salaryIncomeRows) {
      const ids = salaryIncomeIdsByRuleId.get(r.savingsRuleId) ?? [];
      ids.push(r.incomeId);
      salaryIncomeIdsByRuleId.set(r.savingsRuleId, ids);
    }

    return NextResponse.json(
      rows.map((r) => ({ ...r, salaryIncomeIds: salaryIncomeIdsByRuleId.get(r.id) ?? [] })),
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/savings-rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/savings-rules — create savings rule for base case scenario
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await createSavingsRuleForClient({
      clientId: id,
      firmId,
      actorId: userId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/savings-rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
