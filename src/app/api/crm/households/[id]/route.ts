import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getCrmHousehold,
  updateCrmHousehold,
  softDeleteCrmHousehold,
} from "@/lib/crm/households";
import { updateCrmHouseholdSchema } from "@/lib/crm/schemas";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const household = await getCrmHousehold(id);
    if (!household) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ household });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/crm/households/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateCrmHouseholdSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const updated = await updateCrmHousehold(id, parsed.data);
    return NextResponse.json({ household: updated });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "Household not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("PATCH /api/crm/households/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgAdminOrOwner();
    const { id } = await params;
    const { userId } = await auth();
    await softDeleteCrmHousehold(id, userId ?? "system");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    if (err instanceof Error && err.message === "Household not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/crm/households/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
