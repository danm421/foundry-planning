import { NextRequest, NextResponse } from "next/server";
import { createCrmAccount } from "@/lib/crm/accounts";
import { createCrmAccountSchema } from "@/lib/crm/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: householdId } = await params;
    const body = await req.json();
    const parsed = createCrmAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const created = await createCrmAccount(householdId, parsed.data);
    return NextResponse.json({ account: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("POST /api/crm/households/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
