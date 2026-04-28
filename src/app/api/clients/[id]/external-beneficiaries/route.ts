import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, externalBeneficiaries } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { externalBeneficiaryCreateSchema } from "@/lib/schemas/beneficiaries";

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
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, id))
      .orderBy(asc(externalBeneficiaries.name));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/external-beneficiaries error:", err);
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
    const parsed = externalBeneficiaryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const [row] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        charityType: parsed.data.charityType ?? "public",
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
