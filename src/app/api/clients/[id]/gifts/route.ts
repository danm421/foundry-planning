import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gifts, scenarios } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { loadActiveGiftChanges } from "@/lib/scenario/changes";
import { partitionGiftChanges } from "@/lib/scenario/apply-gift-overlays";
import { giftDraftToRow } from "@/lib/gifts/scenario-rows";
import type { Gift } from "@/components/family-view";
import { createGiftForClient } from "@/lib/clients/gifts-writes";

/**
 * Adapt a scenario-added `Gift` (numbers, from `giftDraftToRow`) to the same
 * wire shape a `db.select().from(gifts)` row serializes as: numeric columns
 * as decimal strings (Postgres `numeric`), plus the columns only a real DB
 * row carries (`clientId`, `liabilityId`, `businessEntityId`, `parentGiftId`,
 * `yearRef`) — none of which a scenario-only draft has. `createdAt` /
 * `updatedAt` are left off rather than invented; nothing timestamps a gift
 * that was never written to the `gifts` table.
 */
function giftRowToWireShape(g: Gift, clientId: string) {
  return {
    id: g.id,
    clientId,
    year: g.year,
    yearRef: null,
    amount: g.amount != null ? g.amount.toFixed(2) : null,
    grantor: g.grantor,
    recipientEntityId: g.recipientEntityId,
    recipientFamilyMemberId: g.recipientFamilyMemberId,
    recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId,
    accountId: g.accountId,
    liabilityId: null,
    businessEntityId: null,
    percent: g.percent != null ? g.percent.toFixed(4) : null,
    valuationDiscount:
      g.valuationDiscount != null ? g.valuationDiscount.toFixed(4) : null,
    parentGiftId: null,
    useCrummeyPowers: g.useCrummeyPowers,
    // A base row always carries a real `event_kind` (NOT NULL DEFAULT
    // 'outright'), so a scenario-only gift must too — otherwise one endpoint
    // returns two different wire shapes and a non-outright gift (a CLT's
    // remainder interest) reads as an ordinary one only while a scenario is
    // active. The mappers always populate it; the fallback covers the older
    // `Gift` literals that predate the field.
    eventKind: g.eventKind ?? "outright",
    notes: g.notes,
  };
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(gifts)
      .where(eq(gifts.clientId, id))
      .orderBy(asc(gifts.year), asc(gifts.createdAt));

    // No ?scenario= (or the literal "base") — today's behavior, byte-identical:
    // no scenario lookup at all.
    const requestedScenario = new URL(request.url).searchParams.get("scenario");
    if (!requestedScenario || requestedScenario === "base") {
      return NextResponse.json(rows);
    }

    // Client-scoped lookup, mirroring gifts/series/route.ts's resolveScenarioId.
    // verifyClientAccess above already gated the client; eq(scenarios.clientId, id)
    // still guards against a foreign scenario id resolving here.
    const [scenario] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.id, requestedScenario), eq(scenarios.clientId, id)));
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const giftChanges = await loadActiveGiftChanges(scenario.id);
    const { targeted, adds } = partitionGiftChanges(giftChanges);

    // Base survivors keep their exact DB row shape (decimal-string numerics,
    // plus the columns a Gift-shaped draft never carries) — only the added
    // rows need adapting, so they alone go through giftRowToWireShape.
    const survivors = rows.filter((g) => !targeted.has(g.id));
    const added = adds
      .map(giftDraftToRow)
      .filter((g): g is Gift => g !== null)
      .map((g) => giftRowToWireShape(g, id));

    // RULING 27: stable sort by year. Base rows already arrive year/createdAt
    // ascending, so this only interleaves the scenario's adds without
    // reordering same-source ties. Array.prototype.sort is stable (ES2019+).
    const overlaid = [...survivors, ...added].sort((a, b) => a.year - b.year);
    return NextResponse.json(overlaid);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const body = await request.json();
    const result = await createGiftForClient({
      clientId: id,
      firmId,
      input: body,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
