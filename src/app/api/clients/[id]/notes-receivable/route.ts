import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  externalBeneficiaries,
  familyMembers,
  noteExtraPayments,
  noteReceivableOwners,
  notesReceivable,
  scenarios,
} from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { assertEntitiesInClient } from "@/lib/db-scoping";
import { recordCreate } from "@/lib/audit";
import { toNoteReceivableSnapshot } from "@/lib/audit/snapshots/note-receivable";
import {
  noteReceivableCreateSchema,
  type NoteReceivableOwnerInput,
} from "@/lib/schemas/note-receivable";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(
      and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)),
    );
  return scenario?.id ?? null;
}

async function validateOwnersBelongToClient(
  clientId: string,
  owners: NoteReceivableOwnerInput[],
): Promise<{ error: string } | null> {
  const familyIds = owners.map((o) => o.familyMemberId).filter((x): x is string => !!x);
  const entityIds = owners.map((o) => o.entityId).filter((x): x is string => !!x);
  const extIds = owners
    .map((o) => o.externalBeneficiaryId)
    .filter((x): x is string => !!x);

  if (familyIds.length > 0) {
    const rows = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, familyIds),
        ),
      );
    if (rows.length !== familyIds.length) {
      return { error: "Family member owner not found for this client" };
    }
  }
  if (entityIds.length > 0) {
    const check = await assertEntitiesInClient(clientId, entityIds);
    if (!check.ok) return { error: check.reason };
  }
  if (extIds.length > 0) {
    const rows = await db
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, extIds),
        ),
      );
    if (rows.length !== extIds.length) {
      return { error: "External beneficiary owner not found for this client" };
    }
  }
  return null;
}

// GET /api/clients/[id]/notes-receivable — list for base case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(notesReceivable)
      .where(
        and(
          eq(notesReceivable.clientId, id),
          eq(notesReceivable.scenarioId, scenarioId),
        ),
      );

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/notes-receivable error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/notes-receivable — create note
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

    const body = await request.json();
    const parsed = noteReceivableCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const ownerSum = input.owners.reduce((acc, o) => acc + o.percent, 0);
    if (Math.abs(ownerSum - 1) > 0.0001) {
      return NextResponse.json(
        { error: "Owner percents must sum to 1 (100%)" },
        { status: 400 },
      );
    }

    const ownerErr = await validateOwnersBelongToClient(id, input.owners);
    if (ownerErr) {
      return NextResponse.json({ error: ownerErr.error }, { status: 400 });
    }

    if (input.linkedTrustEntityId) {
      const check = await assertEntitiesInClient(id, [input.linkedTrustEntityId]);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }

    let note: typeof notesReceivable.$inferSelect;
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(notesReceivable)
        .values({
          clientId: id,
          scenarioId,
          name: input.name,
          faceValue: String(input.faceValue),
          basis: String(input.basis),
          asOfBalance: input.asOfBalance != null ? String(input.asOfBalance) : null,
          balanceAsOfMonth: input.balanceAsOfMonth ?? null,
          balanceAsOfYear: input.balanceAsOfYear ?? null,
          interestRate: String(input.interestRate),
          paymentType: input.paymentType,
          monthlyPayment:
            input.monthlyPayment != null ? String(input.monthlyPayment) : null,
          startYear: input.startYear,
          startMonth: input.startMonth,
          startYearRef: input.startYearRef ?? null,
          termMonths: input.termMonths,
          linkedTrustEntityId: input.linkedTrustEntityId ?? null,
        })
        .returning();
      note = inserted;

      for (const o of input.owners) {
        await tx.insert(noteReceivableOwners).values({
          noteReceivableId: note.id,
          familyMemberId: o.familyMemberId ?? null,
          entityId: o.entityId ?? null,
          externalBeneficiaryId: o.externalBeneficiaryId ?? null,
          percent: String(o.percent),
        });
      }

      for (const ep of input.extraPayments) {
        await tx.insert(noteExtraPayments).values({
          noteReceivableId: note.id,
          year: ep.year,
          type: ep.type,
          amount: String(ep.amount),
        });
      }
    });

    await recordCreate({
      action: "note_receivable.create",
      resourceType: "note_receivable",
      resourceId: note!.id,
      clientId: id,
      firmId,
      snapshot: await toNoteReceivableSnapshot(note!),
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(note!, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/notes-receivable error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
