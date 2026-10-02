import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entities, familyMembers, externalBeneficiaries, giftSeries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { giftSeriesSchema } from "@/lib/schemas/gift-series";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { getBaseCaseScenarioId, resolveScenarioId } from "@/lib/scenario/resolve-scenario-param";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { loadActiveGiftChanges } from "@/lib/scenario/changes";
import { partitionGiftChanges } from "@/lib/scenario/apply-gift-overlays";
import { giftDraftToSeriesRow } from "@/lib/gifts/scenario-rows";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/gifts/series — list gift_series rows for the base case, or
// for ?scenario= the partition plus that scenario's overlay series
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

    if (requestedScenario == null || requestedScenario === "base") {
      return NextResponse.json(rows);
    }

    // A scenario's recurring gifts are also its own `gift` changes (overlay
    // series), which no partition row carries. List them beside the partition
    // rows, marked `overlay`, the way `overlayScenarioGiftRows` does for the
    // Family page: an add on a partition row's id replaces it, a remove drops it.
    const { targeted, adds } = partitionGiftChanges(await loadActiveGiftChanges(scenarioId));
    const overlay = adds.flatMap((a) => {
      const row = giftDraftToSeriesRow(a);
      return row ? [{ ...row, overlay: true as const }] : [];
    });
    return NextResponse.json([...rows.filter((r) => !targeted.has(r.id)), ...overlay]);
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
        valuationDiscount:
          data.valuationDiscount != null ? String(data.valuationDiscount) : null,
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
