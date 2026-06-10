import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";
import { checkImportRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import {
  listCrmDocuments,
  uploadCrmDocument,
  MAX_SIZE_BYTES,
} from "@/lib/crm/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const folderId = req.nextUrl.searchParams.get("folderId");
    const docs = await listCrmDocuments(id, {
      folderId: folderId === null ? undefined : folderId === "root" ? null : folderId,
    });
    return NextResponse.json({ documents: docs });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Staff (operations/planner) not mapped to the household's advisor:
    // requireVaultAccess throws ForbiddenError. Map to 403 (not 500) so the
    // denial is a clean status, consistent with the sibling zip route.
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("GET /api/crm/households/[id]/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const firmId = await requireOrgId();

    const rl = await checkImportRateLimit(firmId, "upload");
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Document upload rate limit exceeded");
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_SIZE_BYTES + 65536) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 413 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 413 },
      );
    }

    const folderIdRaw = formData.get("folderId");
    const descriptionRaw = formData.get("description");
    const folderId = typeof folderIdRaw === "string" && folderIdRaw !== "" ? folderIdRaw : null;
    const description = typeof descriptionRaw === "string" && descriptionRaw !== "" ? descriptionRaw : null;

    const doc = await uploadCrmDocument(id, file, { folderId, description });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof Error && err.message.startsWith("File too large")) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error("POST /api/crm/households/[id]/documents failed:", safeMessage);
    return NextResponse.json(
      { error: "Document upload failed. Please try again." },
      { status: 500 },
    );
  }
}
