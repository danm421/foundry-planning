import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  gifts,
  entities,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { giftUpdateSchema } from "@/lib/schemas/gifts";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, giftId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = giftUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const patch = parsed.data as {
      year?: number;
      amount?: number;
      grantor?: "client" | "spouse" | "joint";
      recipientEntityId?: string | null;
      recipientFamilyMemberId?: string | null;
      recipientExternalBeneficiaryId?: string | null;
      useCrummeyPowers?: boolean;
      notes?: string | null;
    };

    if (patch.recipientEntityId) {
      const [entity] = await db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          isIrrevocable: entities.isIrrevocable,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, patch.recipientEntityId),
            eq(entities.clientId, id),
          ),
        );
      if (!entity) {
        return NextResponse.json(
          { error: "Recipient entity not found for this client" },
          { status: 400 },
        );
      }
      if (entity.entityType !== "trust") {
        return NextResponse.json(
          { error: "Recipient must be a trust" },
          { status: 400 },
        );
      }
      if (!entity.isIrrevocable) {
        return NextResponse.json(
          { error: "Gifts to revocable trusts are not completed gifts" },
          { status: 400 },
        );
      }
    }
    if (patch.recipientFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, patch.recipientFamilyMemberId),
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
    if (patch.recipientExternalBeneficiaryId) {
      const [ext] = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, patch.recipientExternalBeneficiaryId),
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
      .update(gifts)
      .set({
        ...(patch.year !== undefined && { year: patch.year }),
        ...(patch.amount !== undefined && { amount: String(patch.amount) }),
        ...(patch.grantor !== undefined && { grantor: patch.grantor }),
        ...(patch.recipientEntityId !== undefined && {
          recipientEntityId: patch.recipientEntityId ?? null,
        }),
        ...(patch.recipientFamilyMemberId !== undefined && {
          recipientFamilyMemberId: patch.recipientFamilyMemberId ?? null,
        }),
        ...(patch.recipientExternalBeneficiaryId !== undefined && {
          recipientExternalBeneficiaryId:
            patch.recipientExternalBeneficiaryId ?? null,
        }),
        ...(patch.useCrummeyPowers !== undefined && {
          useCrummeyPowers: patch.useCrummeyPowers,
        }),
        ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, giftId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [row] = await db
      .delete(gifts)
      .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
