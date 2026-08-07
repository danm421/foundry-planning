import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { addDocumentToReturn, TaxYearMismatchError } from "@/lib/tax-returns/add-document";
import { TaxReturnExtractionError } from "@/lib/tax-returns/errors";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // synchronous AI extraction, like the year POST

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const roleSchema = z.enum(["auto", "full_return", "k1", "w2", "other"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string }> },
) {
  try {
    const firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId, sessionClaims } = await auth();
    if (!userId) throw new UnauthorizedError();
    const { id: clientId, taxYear: rawYear } = await params;

    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });

    const access = await verifyClientAccess(clientId);
    if (!access.ok) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (access.access !== "own" || access.permission !== "edit") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const rl = await checkImportRateLimit(firmId, "extract");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many extraction requests. Please wait and try again." },
        { status: rl.reason === "exceeded" ? 429 : 503 },
      );
    }

    const entitlements = (
      sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null
    )?.org_public_metadata?.entitlements;
    if (!entitlements?.includes("ai_import")) {
      await recordAudit({
        action: "billing.access_denied",
        resourceType: "firm",
        resourceId: firmId,
        clientId,
        firmId,
        metadata: { reason: "ai_import_not_entitled", surface: "tax_return_documents" },
      });
      return NextResponse.json({ error: "ai_import_not_entitled" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large (25MB max)" }, { status: 400 });
    }

    const roleRaw = form.get("role");
    const parsedRole = roleSchema.safeParse(typeof roleRaw === "string" && roleRaw ? roleRaw : "auto");
    if (!parsedRole.success) {
      return NextResponse.json({ error: "Unknown document type" }, { status: 400 });
    }

    const existing = await getTaxReturn(clientId, taxYear);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = detectUploadKind(buffer);
    if (kind !== "pdf" && kind !== "png" && kind !== "jpeg") {
      return NextResponse.json(
        { error: "Tax return analysis accepts PDF or image uploads." },
        { status: 400 },
      );
    }
    const filename = file instanceof File ? file.name : "tax-document.pdf";
    const model = form.get("model") === "mini" ? ("mini" as const) : ("full" as const);

    // Best-effort, same as the year POST: keep the source with the client's documents.
    const vaultDoc = await savePlanToVault({
      clientId,
      firmId,
      reportType: "tax_return_source",
      scenarioId: null,
      filename,
      buffer,
      uploadedBy: userId,
    });

    let added;
    try {
      added = await addDocumentToReturn({
        taxReturnId: existing.id,
        taxYear,
        buffer,
        filename,
        uploadKind: kind,
        model,
        role: parsedRole.data,
        vaultDocumentId: vaultDoc?.id ?? null,
      });
    } catch (err) {
      if (err instanceof TaxYearMismatchError) {
        return NextResponse.json(
          { error: "year_mismatch", message: err.userMessage, documentYear: err.documentYear },
          { status: 409 },
        );
      }
      if (err instanceof TaxReturnExtractionError) {
        return NextResponse.json({ error: err.userMessage }, { status: 422 });
      }
      throw err;
    }

    await recordAudit({
      action: "tax_return.document_add",
      resourceType: "tax_return",
      resourceId: `${clientId}:${taxYear}`,
      clientId,
      firmId,
      metadata: { taxYear, role: added.role, documentId: added.documentId },
    });

    return NextResponse.json(added);
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/tax-returns/[taxYear]/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
