import { NextResponse } from "next/server";
import {
  extractClientIp,
  checkIntakeDocumentRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { loadFormByToken, type IntakeFormRow } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { isGateVerified } from "@/lib/intake/gate-session";
import {
  uploadIntakeDocument,
  listIntakeDocuments,
  type IntakeDocType,
} from "@/lib/intake/documents";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";

export const dynamic = "force-dynamic";

const DOC_TYPES: readonly IntakeDocType[] = [
  "statement",
  "paystub",
  "mortgage",
  "tax_return",
  "estate",
  "insurance",
  "other",
];

/**
 * Public (no auth), token-scoped document upload for the intake wizard.
 *
 * There is deliberately NO download handler in this directory. The client can
 * list what they uploaded by name and remove a mistake, but can never retrieve
 * the bytes — enforced by the route not existing, not by a check.
 */

type GateResult =
  | { error: NextResponse; form?: undefined }
  | { error?: undefined; form: IntakeFormRow };

/** Shared gate: rate limit → token → form → expiry → status → identity cookie. */
async function gate(token: string, req: Request): Promise<GateResult> {
  const ip = extractClientIp(req);
  const rl = await checkIntakeDocumentRateLimit(`${token}:${ip}`);
  if (!rl.allowed) {
    return { error: rateLimitErrorResponse(rl, "Too many uploads. Please slow down.") };
  }

  const form = await loadFormByToken(token);
  if (!form) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  if (isExpired(form, new Date())) {
    return { error: NextResponse.json({ error: "This form link has expired." }, { status: 410 }) };
  }
  if (form.status !== "draft") {
    return {
      error: NextResponse.json(
        { error: "This form has already been submitted." },
        { status: 409 },
      ),
    };
  }
  if (!(await isGateVerified(form.id))) {
    return { error: NextResponse.json({ error: "Verification required." }, { status: 401 }) };
  }
  return { form };
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const gated = await gate(token, req);
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
  if (!DOC_TYPES.includes(docType as IntakeDocType)) {
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
  const gated = await gate(token, req);
  if (gated.error) return gated.error;

  const documents = await listIntakeDocuments(gated.form.id);
  return NextResponse.json({ documents });
}
