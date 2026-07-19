import { NextRequest, NextResponse } from "next/server";
import {
  listHouseholdRelationships,
  createHouseholdRelationship,
  HouseholdsAlreadyLinkedError,
  SelfLinkError,
} from "@/lib/crm/household-relationships";
import { createHouseholdRelationshipSchema } from "@/lib/crm/schemas";
import { UnauthorizedError } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relationships = await listHouseholdRelationships(id);
    return NextResponse.json({ relationships });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message.startsWith("CRM household not found or access denied")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("GET /api/crm/households/[id]/relationships error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = createHouseholdRelationshipSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const relationship = await createHouseholdRelationship(id, parsed.data);
    return NextResponse.json({ relationship }, { status: 201 });
  } catch (err) {
    if (err instanceof SelfLinkError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof HouseholdsAlreadyLinkedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message.startsWith("CRM household not found or access denied")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("POST /api/crm/households/[id]/relationships error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
