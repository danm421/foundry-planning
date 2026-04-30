import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImportFiles } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { uploadImportFile } from "@/lib/imports/blob";
import { sha256Hex } from "@/lib/imports/file-hash";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Mirrors src/db/schema.ts importDocumentTypeEnum. We keep a literal
// runtime list because the Drizzle pgEnum doesn't expose its values to
// JS callers; if the enum changes, this list and the schema must move
// together.
const VALID_DOC_TYPES = [
  "auto",
  "account_statement",
  "pay_stub",
  "insurance",
  "expense_worksheet",
  "tax_return",
  "excel_import",
  "fact_finder",
  "will",
  "family_fact_finder",
] as const;
type DocumentType = (typeof VALID_DOC_TYPES)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      // requireOrgId already verified userId, but TS doesn't know that.
      throw new UnauthorizedError();
    }
    const { id: clientId, importId } = await params;

    const rl = await checkImportRateLimit(firmId, "upload");
    if (!rl.allowed) {
      let status: number;
      let message: string;
      switch (rl.reason) {
        case "unconfigured":
          status = 503;
          message = "Rate limiting is not configured — file uploads are disabled.";
          break;
        case "redis_error":
          status = 503;
          message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
          break;
        case "exceeded":
          status = 429;
          message = "Too many upload requests. Please wait and try again.";
          break;
      }
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(
          Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
        );
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    // Loads + verifies the import row (and transitively the client). Throws
    // NotFoundError / ForbiddenError that the catch block maps to status.
    await requireImportAccess({ importId, clientId, firmId, userId });

    // Cheap pre-buffer rejection for obviously oversized bodies. Real
    // enforcement is the file.size check below — Content-Length is
    // client-controlled and unsafe to trust on its own.
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 65536) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20MB." },
        { status: 413 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentTypeRaw = (formData.get("documentType") as string | null) ?? "auto";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20MB." },
        { status: 413 },
      );
    }

    if (!(VALID_DOC_TYPES as readonly string[]).includes(documentTypeRaw)) {
      return NextResponse.json(
        { error: `Invalid document type: ${documentTypeRaw}` },
        { status: 400 },
      );
    }
    const documentType = documentTypeRaw as DocumentType;

    const buffer = Buffer.from(await file.arrayBuffer());

    // Magic-byte detection — refuse anything we can't safely parse later
    // even if the filename extension says otherwise.
    const kind = detectUploadKind(buffer);
    if (!kind) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, Excel, or CSV file." },
        { status: 400 },
      );
    }

    // Content-hash dedup within this import. If the advisor uploads the
    // same file twice (common with browser drag-and-drop retries), we
    // return the existing row instead of re-uploading to blob storage.
    const hash = await sha256Hex(buffer);
    const existing = await db
      .select()
      .from(clientImportFiles)
      .where(
        and(
          eq(clientImportFiles.importId, importId),
          eq(clientImportFiles.contentHash, hash),
          isNull(clientImportFiles.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ file: existing[0], deduped: true });
    }

    const fileId = crypto.randomUUID();
    const { url: blobUrl, pathname: blobPathname } = await uploadImportFile({
      importId,
      fileId,
      filename: file.name,
      body: buffer,
    });

    const [row] = await db
      .insert(clientImportFiles)
      .values({
        id: fileId,
        importId,
        blobUrl,
        blobPathname,
        originalFilename: file.name,
        contentHash: hash,
        sizeBytes: file.size,
        detectedKind: kind,
        documentType,
      })
      .returning();

    await recordAudit({
      action: "import.file.uploaded",
      resourceType: "client_import_file",
      resourceId: fileId,
      clientId,
      firmId,
      metadata: {
        importId,
        contentHash: hash,
        sizeBytes: file.size,
        detectedKind: kind,
        documentType,
      },
    });

    return NextResponse.json({ file: row, deduped: false });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    // Truncate to avoid leaking blob/Azure stack details into Vercel
    // Runtime Logs — match the extract route's posture.
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(
      "POST /api/clients/[id]/imports/[importId]/files failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}
