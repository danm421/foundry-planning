import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { externalBeneficiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { externalBeneficiaryUpdateSchema } from "@/lib/schemas/beneficiaries";
import { cleanupWillRecipientReferences } from "@/lib/estate/cleanup-will-recipients";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    await requireOrgAndUser();
    const { id, beneficiaryId } = await params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const body = await request.json();
    const parsed = externalBeneficiaryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const [row] = await db
      .update(externalBeneficiaries)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(externalBeneficiaries.id, beneficiaryId),
          eq(externalBeneficiaries.clientId, id),
        ),
      )
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH external-beneficiaries/[beneficiaryId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    await requireOrgAndUser();
    const { id, beneficiaryId } = await params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    // Delete the beneficiary and, atomically, any will-recipient rows that point
    // at it — recipient_id is a polymorphic FK-less column, so a plain delete
    // would leave a dangling id and silently wrong estate projections (audit F13).
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, beneficiaryId),
            eq(externalBeneficiaries.clientId, id),
          ),
        )
        .returning();
      if (!row) return null;
      await cleanupWillRecipientReferences(tx, "external_beneficiary", beneficiaryId);
      await pruneOrphanScenarioChanges(tx, beneficiaryId);
      return row;
    });
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE external-beneficiaries/[beneficiaryId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
