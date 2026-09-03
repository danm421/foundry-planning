import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { planObservationContext, scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { observationContextPatchSchema } from "@/lib/schemas/observations";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

/** The advisor's notes to the model about this household and the scenario
 *  the next steps are generated from. Household-shaped, not client-facing —
 *  see the table comment in schema.ts. */
function shape(row: {
  observationsContext: string;
  nextStepsContext: string;
  nextStepsScenarioId: string | null;
} | undefined) {
  return {
    observationsContext: row?.observationsContext ?? "",
    nextStepsContext: row?.nextStepsContext ?? "",
    nextStepsScenarioId: row?.nextStepsScenarioId ?? null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [row] = await db
      .select()
      .from(planObservationContext)
      .where(eq(planObservationContext.clientId, id));
    return NextResponse.json(shape(row));
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/observations/context error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(observationContextPatchSchema, request);
    if (!parsed.ok) return parsed.response;
    const { observationsContext, nextStepsContext, nextStepsScenarioId } = parsed.data;

    // The scenario must be this client's and not the base case — the base
    // case has no edits to turn into steps, and the picker never offers it.
    if (nextStepsScenarioId) {
      const [owned] = await db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(
          and(
            eq(scenarios.id, nextStepsScenarioId),
            eq(scenarios.clientId, id),
            eq(scenarios.isBaseCase, false),
          ),
        );
      if (!owned) {
        return NextResponse.json(
          { error: "Pick one of this client's scenarios (not the base case)." },
          { status: 400 },
        );
      }
    }

    const set = {
      ...(observationsContext !== undefined && { observationsContext }),
      ...(nextStepsContext !== undefined && { nextStepsContext }),
      ...(nextStepsScenarioId !== undefined && { nextStepsScenarioId }),
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(planObservationContext)
      .values({ clientId: id, ...set })
      .onConflictDoUpdate({ target: planObservationContext.clientId, set })
      .returning();

    await recordAudit({
      action: "plan_observation_context.update",
      resourceType: "plan_observation_context",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        fields: Object.keys(parsed.data),
      }),
    });

    return NextResponse.json(shape(row));
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/observations/context error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
