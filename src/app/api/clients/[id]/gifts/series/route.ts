import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, entities, familyMembers, externalBeneficiaries, giftSeries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { giftSeriesSchema } from "@/lib/schemas/gift-series";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  // LIMIT 2 to surface the "multiple base scenarios" data-integrity bug loudly
  // rather than silently picking an arbitrary one.
  const baseScenarios = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(2);

  if (baseScenarios.length > 1) {
    throw new Error(
      `Multiple base scenarios for client ${clientId}: invariant violated`,
    );
  }
  return baseScenarios[0]?.id ?? null;
}

// Resolve the scenario partition a gift_series read/write should land in.
// gift_series carries a real scenario_id (it is NOT an overlay TargetKind), so a
// series created while a scenario is active must be written to THAT scenario or
// the loader (which filters giftSeries.scenarioId = scenario.id) drops it.
// `null`/`"base"` resolve to the base case; any other value must be a scenario
// belonging to a client in THIS firm (the innerJoin enforces firm scope), so a
// foreign or unknown id returns undefined and the caller 404s instead of
// touching another firm's data.
async function resolveScenarioId(
  clientId: string,
  requested: string | null,
): Promise<string | null | undefined> {
  if (requested == null || requested === "base") {
    return getBaseCaseScenarioId(clientId);
  }
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return undefined;
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(
      and(
        eq(scenarios.id, requested),
        eq(scenarios.clientId, clientId),
      ),
    );
  return scenario?.id;
}

// GET /api/clients/[id]/gifts/series — list gift_series rows for base-case scenario
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // List the active scenario's series when one is selected (?scenario=<sid>),
    // else the base case — must match the partition POST just wrote to.
    const requestedScenario = new URL(request.url).searchParams.get("scenario");
    const scenarioId = await resolveScenarioId(id, requestedScenario);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(giftSeries)
      .where(and(eq(giftSeries.clientId, id), eq(giftSeries.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/gifts/series error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/gifts/series — create a gift_series row (base-case scenario)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // gift_series is scenario-scoped: write into the active scenario when one is
    // selected (?scenario=<sid>), not always base — otherwise the loader (which
    // filters by scenario_id) never surfaces the row under that scenario and it
    // silently pollutes base. baseId doubles as the firm-scoped client gate.
    const baseId = await getBaseCaseScenarioId(id);
    if (!baseId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const requestedScenario = new URL(request.url).searchParams.get("scenario");
    const scenarioId = await resolveScenarioId(id, requestedScenario);
    if (!scenarioId) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const parsed = await parseBody(giftSeriesSchema, request);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // Per-kind recipient validation (security boundary: belongs-to-client checks
    // prevent IDOR; entity path additionally enforces irrevocable-trust requirement).
    if (data.recipientEntityId) {
      const [trust] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, data.recipientEntityId), eq(entities.clientId, id)));
      if (!trust) {
        return NextResponse.json(
          { error: "Recipient entity not found for this client" },
          { status: 400 },
        );
      }
      if (trust.entityType !== "trust" || !trust.isIrrevocable) {
        return NextResponse.json(
          { error: "Recurring gifts target irrevocable trusts only" },
          { status: 400 },
        );
      }
    }
    if (data.recipientFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, data.recipientFamilyMemberId),
            eq(familyMembers.clientId, id),
          ),
        );
      if (!fm) {
        return NextResponse.json(
          { error: "Recipient family member not found for this client" },
          { status: 400 },
        );
      }
    }
    if (data.recipientExternalBeneficiaryId) {
      const [ext] = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, data.recipientExternalBeneficiaryId),
            eq(externalBeneficiaries.clientId, id),
          ),
        );
      if (!ext) {
        return NextResponse.json(
          { error: "Recipient external beneficiary not found for this client" },
          { status: 400 },
        );
      }
    }

    const [row] = await db
      .insert(giftSeries)
      .values({
        clientId: id,
        scenarioId,
        grantor: data.grantor,
        recipientEntityId: data.recipientEntityId ?? null,
        recipientFamilyMemberId: data.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: data.recipientExternalBeneficiaryId ?? null,
        startYear: data.startYear,
        startYearRef: (data.startYearRef ??
          null) as typeof giftSeries.$inferInsert["startYearRef"],
        endYear: data.endYear,
        endYearRef: (data.endYearRef ??
          null) as typeof giftSeries.$inferInsert["endYearRef"],
        annualAmount: data.annualAmount.toString(),
        amountMode: data.amountMode ?? "fixed",
        inflationAdjust: data.inflationAdjust ?? false,
        useCrummeyPowers: data.useCrummeyPowers ?? false,
        notes: data.notes ?? null,
      })
      .returning();

    await recordAudit({
      action: "gift_series.create",
      resourceType: "gift_series",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        grantor: row.grantor,
        startYear: row.startYear,
        endYear: row.endYear,
      }),
    });

    // Return the full inserted row (not just { id }) so the GiftDialog's
    // optimistic list update has grantor/years/amountMode/etc. without a refetch.
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/gifts/series error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
