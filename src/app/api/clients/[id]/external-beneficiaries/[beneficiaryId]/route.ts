import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, externalBeneficiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { externalBeneficiaryUpdateSchema } from "@/lib/schemas/beneficiaries";

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
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, beneficiaryId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = externalBeneficiaryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
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
    const firmId = await getOrgId();
    const { id, beneficiaryId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [row] = await db
      .delete(externalBeneficiaries)
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE external-beneficiaries/[beneficiaryId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
