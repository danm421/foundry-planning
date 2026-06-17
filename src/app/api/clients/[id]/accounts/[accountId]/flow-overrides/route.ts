import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  accounts,
  scenarios,
  accountFlowOverrides,
} from "@/db/schema";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { flowOverrideBulkSchema } from "@/lib/schemas/flow-overrides";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

// Per-year flow overrides only apply to top-level business accounts
// (category='business', parent_account_id IS NULL). The engine reads these
// when `accounts.flowMode === 'schedule'`. Any other account shape is rejected
// at the API boundary so bad client code can't write rows that the engine
// would silently ignore.
async function authorize(clientId: string, accountId: string) {
  const firmId = await requireOrgId();
  const a = await verifyClientAccess(clientId);
  if (!a.ok) {
    return { error: "Client not found", status: 404 as const };
  }
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  if (!account) return { error: "Account not found", status: 404 as const };
  if (account.category !== "business" || account.parentAccountId !== null) {
    return {
      error: "Flow overrides apply only to top-level business accounts",
      status: 400 as const,
    };
  }
  return { firmId, account };
}

// Missing/empty `scenarioId` query param → base-plan overrides (scenario_id IS NULL).
function scenarioFilter(scenarioId: string | null): SQL | undefined {
  return scenarioId
    ? eq(accountFlowOverrides.scenarioId, scenarioId)
    : isNull(accountFlowOverrides.scenarioId);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const scenarioId = new URL(req.url).searchParams.get("scenarioId");
    const auth = await authorize(id, accountId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (scenarioId) {
      const [scenario] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, id)));
      if (!scenario) {
        return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
      }
    }

    const rows = await db
      .select({
        year: accountFlowOverrides.year,
        incomeAmount: accountFlowOverrides.incomeAmount,
        expenseAmount: accountFlowOverrides.expenseAmount,
        distributionPercent: accountFlowOverrides.distributionPercent,
      })
      .from(accountFlowOverrides)
      .where(
        and(
          eq(accountFlowOverrides.accountId, accountId),
          scenarioFilter(scenarioId),
        ),
      );

    return NextResponse.json({
      overrides: rows.map((r) => ({
        year: r.year,
        incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
        expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
        distributionPercent:
          r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts/[accountId]/flow-overrides error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const scenarioId = new URL(req.url).searchParams.get("scenarioId");
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
    const auth = await authorize(id, accountId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (scenarioId) {
      const [scenario] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, id)));
      if (!scenario) {
        return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
      }
    }

    const body = await req.json();
    const parsed = flowOverrideBulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }

    // Whole-grid replace in a transaction.
    await db.transaction(async (tx) => {
      await tx
        .delete(accountFlowOverrides)
        .where(
          and(
            eq(accountFlowOverrides.accountId, accountId),
            scenarioFilter(scenarioId),
          ),
        );
      if (parsed.data.overrides.length > 0) {
        await tx.insert(accountFlowOverrides).values(
          parsed.data.overrides.map((o) => ({
            accountId,
            scenarioId: scenarioId ?? null,
            year: o.year,
            incomeAmount: o.incomeAmount != null ? String(o.incomeAmount) : null,
            expenseAmount: o.expenseAmount != null ? String(o.expenseAmount) : null,
            distributionPercent:
              o.distributionPercent != null ? String(o.distributionPercent) : null,
          })),
        );
      }
    });

    await recordAudit({
      action: "account_flow_overrides.replace",
      resourceType: "account_flow_overrides",
      resourceId: accountId,
      clientId: id,
      firmId: auth.firmId,
      metadata: { scenarioId: scenarioId ?? null, count: parsed.data.overrides.length },
    });

    return NextResponse.json({ ok: true, count: parsed.data.overrides.length });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/accounts/[accountId]/flow-overrides error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
