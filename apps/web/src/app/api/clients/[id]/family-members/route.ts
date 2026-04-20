import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import { clients, familyMembers } from "@foundry/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/family-members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { firstName, lastName, relationship, dateOfBirth, notes } = body;
    if (!firstName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [member] = await db
      .insert(familyMembers)
      .values({
        clientId: id,
        firstName,
        lastName: lastName ?? null,
        relationship: relationship ?? "child",
        dateOfBirth: dateOfBirth || null,
        notes: notes ?? null,
      })
      .returning();

    return NextResponse.json(member, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/family-members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
