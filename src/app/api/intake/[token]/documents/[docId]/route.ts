import { NextResponse } from "next/server";
import { gateIntakeDocumentRequest } from "@/lib/intake/document-gate";
import { deleteIntakeDocument } from "@/lib/intake/documents";

export const dynamic = "force-dynamic";

/** Remove a document the client uploaded by mistake. Only while the form is
 *  still a draft, and only rows this form's own client created — the lib guard
 *  refuses anything the advisor placed in the vault. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string; docId: string }> },
) {
  const { token, docId } = await params;
  const gated = await gateIntakeDocumentRequest(token, req);
  if (gated.error) return gated.error;

  const removed = await deleteIntakeDocument(gated.form.id, docId);
  // 404, not 403 — never confirm the existence of a document they can't touch.
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
