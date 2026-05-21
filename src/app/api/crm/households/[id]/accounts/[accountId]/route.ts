import { NextRequest, NextResponse } from "next/server";
import { updateCrmAccount, deleteCrmAccount } from "@/lib/crm/accounts";
import { updateCrmAccountSchema } from "@/lib/crm/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const body = await req.json();
    const parsed = updateCrmAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const updated = await updateCrmAccount(accountId, parsed.data);
    return NextResponse.json({ account: updated });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "Account not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("PATCH /api/crm/households/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    await deleteCrmAccount(accountId);
    return NextResponse.json({ ok: true });
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
    console.error("DELETE /api/crm/households/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
