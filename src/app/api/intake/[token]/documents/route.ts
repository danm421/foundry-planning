import { NextResponse } from "next/server";
import { gateIntakeDocumentRequest } from "@/lib/intake/document-gate";
import {
  uploadIntakeDocument,
  listIntakeDocuments,
  INTAKE_DOC_TYPES,
  type IntakeDocType,
} from "@/lib/intake/documents";
import { stagingPrefix, takeStagedUpload, StagedUploadError } from "@/lib/uploads/staged-upload";

export const dynamic = "force-dynamic";

/**
 * Public (no auth), token-scoped document upload for the intake wizard.
 *
 * There is deliberately NO download handler in this directory. The client can
 * list what they uploaded by name and remove a mistake, but can never retrieve
 * the bytes — enforced by the route not existing, not by a check.
 */

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const gated = await gateIntakeDocumentRequest(token, req);
  if (gated.error) return gated.error;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  // The bytes went browser → Blob first (`@/lib/uploads/staged-upload`): a
  // function request body caps at 4.5 MB. Taken before any refusal below, so
  // the staged copy is always deleted.
  let bytes: Buffer<ArrayBuffer>;
  try {
    bytes = await takeStagedUpload(stagingPrefix("intake", gated.form.id), formData.get("stagedPathname"));
  } catch (err) {
    if (err instanceof StagedUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const docType = String(formData.get("docType") ?? "other");
  if (!(INTAKE_DOC_TYPES as readonly string[]).includes(docType)) {
    return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  }
  const name = formData.get("filename");
  const type = formData.get("contentType");
  const file = new File([bytes], typeof name === "string" && name ? name : "document", {
    type: typeof type === "string" ? type : "",
  });

  try {
    const document = await uploadIntakeDocument(gated.form.id, file, docType as IntakeDocType);
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    if (/too large/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    if (/too many documents|total size limit/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const gated = await gateIntakeDocumentRequest(token, req);
  if (gated.error) return gated.error;

  const documents = await listIntakeDocuments(gated.form.id);
  return NextResponse.json({ documents });
}
