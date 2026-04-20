import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  entities,
  beneficiaryDesignations,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { beneficiarySetSchema } from "@/lib/schemas/beneficiaries";

export const dynamic = "force-dynamic";

async function verifyClientAndTrust(
  clientId: string,
  entityId: string,
  firmId: string,
) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return { ok: false as const, reason: "client" as const };
  const [entity] = await db
    .select({ id: entities.id, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.clientId, clientId)));
  if (!entity) return { ok: false as const, reason: "entity" as const };
  if (entity.entityType !== "trust")
    return { ok: false as const, reason: "not_trust" as const };
  return { ok: true as const };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, entityId } = await params;
    const v = await verifyClientAndTrust(id, entityId, firmId);
    if (!v.ok)
      return NextResponse.json(
        { error: v.reason === "not_trust" ? "Entity is not a trust" : "Not found" },
        { status: v.reason === "not_trust" ? 400 : 404 },
      );
    const rows = await db
      .select()
      .from(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, id),
          eq(beneficiaryDesignations.targetKind, "trust"),
          eq(beneficiaryDesignations.entityId, entityId),
        ),
      )
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET trust beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, entityId } = await params;
    const v = await verifyClientAndTrust(id, entityId, firmId);
    if (!v.ok)
      return NextResponse.json(
        { error: v.reason === "not_trust" ? "Entity is not a trust" : "Not found" },
        { status: v.reason === "not_trust" ? 400 : 404 },
      );
    const body = await request.json();
    const parsed = beneficiarySetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const fmIds = parsed.data.map((d) => d.familyMemberId).filter((x): x is string => !!x);
    const extIds = parsed.data.map((d) => d.externalBeneficiaryId).filter((x): x is string => !!x);
    if (fmIds.length > 0) {
      const found = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, id), inArray(familyMembers.id, fmIds)));
      if (found.length !== new Set(fmIds).size) {
        return NextResponse.json(
          { error: "One or more family members not found for this client" },
          { status: 400 },
        );
      }
    }
    if (extIds.length > 0) {
      const found = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.clientId, id),
            inArray(externalBeneficiaries.id, extIds),
          ),
        );
      if (found.length !== new Set(extIds).size) {
        return NextResponse.json(
          { error: "One or more external beneficiaries not found for this client" },
          { status: 400 },
        );
      }
    }

    const inserted = await db.transaction(async (tx) => {
      await tx
        .delete(beneficiaryDesignations)
        .where(
          and(
            eq(beneficiaryDesignations.clientId, id),
            eq(beneficiaryDesignations.targetKind, "trust"),
            eq(beneficiaryDesignations.entityId, entityId),
          ),
        );
      if (parsed.data.length === 0) return [];
      return tx
        .insert(beneficiaryDesignations)
        .values(
          parsed.data.map((d, idx) => ({
            clientId: id,
            targetKind: "trust" as const,
            accountId: null,
            entityId,
            tier: d.tier,
            familyMemberId: d.familyMemberId ?? null,
            externalBeneficiaryId: d.externalBeneficiaryId ?? null,
            percentage: String(d.percentage),
            sortOrder: d.sortOrder ?? idx,
          })),
        )
        .returning();
    });

    return NextResponse.json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT trust beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
