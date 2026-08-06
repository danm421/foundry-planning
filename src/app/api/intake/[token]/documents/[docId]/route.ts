import { NextResponse } from "next/server";
import { z } from "zod";
import { gateIntakeDocumentRequest } from "@/lib/intake/document-gate";
import { deleteIntakeDocument } from "@/lib/intake/documents";

export const dynamic = "force-dynamic";

/** Remove a document the client uploaded by mistake. Only while the form is
 *  still a draft, and only rows this form's own client created — the lib guard
 *  refuses anything the advisor placed in the vault.
 *
 *  There is deliberately NO download/GET handler here — see documents/route.ts.
 *  A future GET on this path would break that guarantee; don't add one. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string; docId: string }> },
) {
  const { token, docId } = await params;
  const gated = await gateIntakeDocumentRequest(token, req);
  if (gated.error) return gated.error;

  // Reject before it ever reaches the uuid column: a malformed id must look
  // identical to a well-formed one that isn't the client's — otherwise the
  // 500 a bad id triggers becomes a way to distinguish the two from outside.
  if (!z.string().uuid().safeParse(docId).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const removed = await deleteIntakeDocument(gated.form.id, docId);
  // 404, not 403 — never confirm the existence of a document they can't touch.
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
