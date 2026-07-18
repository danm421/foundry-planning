import { NextRequest, NextResponse } from "next/server";
import { updateCrmContact, deleteCrmContact } from "@/lib/crm/contacts";
import { updateCrmContactSchema } from "@/lib/crm/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await params;
    const body = await req.json();
    const parsed = updateCrmContactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const updated = await updateCrmContact(contactId, parsed.data);
    return NextResponse.json({ contact: updated });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "Contact not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      err instanceof Error &&
      err.message === "Family member does not belong to this household"
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("PATCH /api/crm/households/[id]/contacts/[contactId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await params;
    await deleteCrmContact(contactId);
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
    console.error("DELETE /api/crm/households/[id]/contacts/[contactId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
