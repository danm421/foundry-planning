import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { externalBeneficiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { externalBeneficiaryUpdateSchema } from "@/lib/schemas/beneficiaries";
import { cleanupWillRecipientReferences } from "@/lib/estate/cleanup-will-recipients";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    await requireOrgId();
    const { id, beneficiaryId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
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
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH external-beneficiaries/[beneficiaryId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    await requireOrgId();
    const { id, beneficiaryId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
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
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE external-beneficiaries/[beneficiaryId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
