import { NextResponse } from "next/server";
import { gateIntakeDocumentRequest } from "@/lib/intake/document-gate";
import {
  uploadIntakeDocument,
  listIntakeDocuments,
  INTAKE_DOC_TYPES,
  type IntakeDocType,
} from "@/lib/intake/documents";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";

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

  // Cheap pre-flight before buffering the body. +64KB covers multipart
  // boundary/header overhead around the file bytes; the real cap is enforced
  // by uploadIntakeDocument below regardless of this check's outcome.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_DOCUMENT_SIZE_BYTES + 65536) {
    return NextResponse.json({ error: "File too large." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  const docType = String(formData.get("docType") ?? "other");
  if (!(INTAKE_DOC_TYPES as readonly string[]).includes(docType)) {
    return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  }

  try {
    const document = await uploadIntakeDocument(gated.form.id, file, docType as IntakeDocType);
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    if (/too large/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    if (/unsupported|unsafe|too many documents|total size limit/i.test(message)) {
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
