import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { refuseSavedFactFinderWithState } from "@/lib/imports/saved-fact-finder";
import { storeImportFile } from "@/lib/imports/store-import-file";
import { StagedUploadError, stagingPrefix, takeStagedUpload } from "@/lib/uploads/staged-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.firmId !== firmId) {
      return NextResponse.json({ error: "Cross-organization imports are not supported." }, { status: 403 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

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
    const imp = await requireImportAccess({ importId, clientId, firmId, userId });

    // A fact finder import saved to the plan is read-only.
    const savedRefusal = refuseSavedFactFinderWithState(imp);
    if (savedRefusal) return savedRefusal;

    const formData = await request.formData();
    const documentTypeRaw = (formData.get("documentType") as string | null) ?? "auto";

    if (!(VALID_DOC_TYPES as readonly string[]).includes(documentTypeRaw)) {
      return NextResponse.json(
        { error: `Invalid document type: ${documentTypeRaw}` },
        { status: 400 },
      );
    }
    const documentType = documentTypeRaw as DocumentType;

    // Staged browser → Blob first (`@/lib/uploads/staged-upload`), so the
    // request carries a pathname, not the file.
    const buffer = await takeStagedUpload(
      stagingPrefix("imports", clientId),
      formData.get("stagedPathname"),
    );
    const name = formData.get("filename");
    const filename = typeof name === "string" && name !== "" ? name : "upload";

    const stored = await storeImportFile({
      importId,
      clientId,
      firmId,
      filename,
      buffer,
      documentType,
    });
    if (!stored.ok) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, Word, Excel (.xlsx), CSV, or image (PNG/JPEG) file." },
        { status: 400 },
      );
    }
    return NextResponse.json({ file: stored.file, deduped: stored.deduped });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof StagedUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
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
