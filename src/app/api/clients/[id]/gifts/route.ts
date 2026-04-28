import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  gifts,
  liabilities,
  entities,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { giftCreateSchema } from "@/lib/schemas/gifts";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(gifts)
      .where(eq(gifts.clientId, id))
      .orderBy(asc(gifts.year), asc(gifts.createdAt));
    return NextResponse.json(rows);
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
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = giftCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    if (data.recipientEntityId) {
      const [entity] = await db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          isIrrevocable: entities.isIrrevocable,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, data.recipientEntityId),
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
          {
            error:
              "Recipient must be a trust (gifts to LLCs / foundations / etc. are not supported)",
          },
          { status: 400 },
        );
      }
      if (!entity.isIrrevocable) {
        return NextResponse.json(
          {
            error:
              "Gifts to revocable trusts are not completed gifts; no exemption is used",
          },
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

    const row = await db.transaction(async (tx) => {
      const [parent] = await tx
        .insert(gifts)
        .values({
          clientId: id,
          year: data.year,
          yearRef: data.yearRef ?? null,
          // amount is only valid for cash gifts; null for asset/liability transfers
          amount: data.accountId == null && data.liabilityId == null
            ? (data.amount != null ? String(data.amount) : null)
            : null,
          grantor: data.grantor,
          recipientEntityId: data.recipientEntityId ?? null,
          recipientFamilyMemberId: data.recipientFamilyMemberId ?? null,
          recipientExternalBeneficiaryId: data.recipientExternalBeneficiaryId ?? null,
          accountId: data.accountId ?? null,
          liabilityId: data.liabilityId ?? null,
          percent: data.percent != null ? String(data.percent) : null,
          parentGiftId: null,
          useCrummeyPowers: data.useCrummeyPowers ?? false,
          notes: data.notes ?? null,
        })
        .returning();

      // If this is an asset transfer (accountId set, no explicit liabilityId),
      // check for a linked liability and auto-create a bundled child gift row.
      if (data.accountId != null && data.liabilityId == null) {
        const linked = await tx.query.liabilities.findFirst({
          where: eq(liabilities.linkedPropertyId, data.accountId),
        });
        if (linked) {
          await tx.insert(gifts).values({
            clientId: id,
            year: data.year,
            yearRef: data.yearRef ?? null,
            amount: null,
            grantor: data.grantor,
            recipientEntityId: data.recipientEntityId ?? null,
            recipientFamilyMemberId: null,
            recipientExternalBeneficiaryId: null,
            accountId: null,
            liabilityId: linked.id,
            percent: data.percent != null ? String(data.percent) : null,
            parentGiftId: parent.id,
            useCrummeyPowers: false,
            notes: `Auto-bundled with asset transfer of account ${data.accountId}`,
          });
        }
      }

      return parent;
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
