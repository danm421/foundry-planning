import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { listTaxReturns, getTaxReturn, upsertExtracted } from "@/lib/tax-returns/store";
import { rowToSummary } from "@/lib/tax-returns/db";
import {
  extractTaxReturnFacts,
  TaxReturnExtractionError,
} from "@/lib/tax-returns/extract-facts";
import {
  emptyTaxReturnFacts,
  TAX_RETURN_MIN_YEAR,
} from "@/lib/schemas/tax-return-facts";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // synchronous AI extraction, like imports extract

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await listTaxReturns(id);
    return NextResponse.json({ returns: rows.map(rowToSummary) });
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/tax-returns error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId, sessionClaims } = await auth();
    if (!userId) throw new UnauthorizedError();
    const { id: clientId } = await params;

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
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
        metadata: { reason: "ai_import_not_entitled", surface: "tax_returns" },
      });
      return NextResponse.json({ error: "ai_import_not_entitled" }, { status: 403 });
    }

    const form = await request.formData();

    // Manual mode: create an empty-facts row for hand entry (the universal
    // fallback when extraction fails or there's no digital copy).
    const manualYearRaw = form.get("manualTaxYear");
    if (typeof manualYearRaw === "string" && manualYearRaw !== "") {
      const manualYear = Number(manualYearRaw);
      if (!Number.isInteger(manualYear) || manualYear < TAX_RETURN_MIN_YEAR) {
        return NextResponse.json(
          { error: `Tax years from ${TAX_RETURN_MIN_YEAR} onward are supported.` },
          { status: 400 },
        );
      }
      const existingManual = await getTaxReturn(clientId, manualYear);
      if (existingManual && form.get("replace") !== "true") {
        return NextResponse.json({ error: "year_exists", taxYear: manualYear }, { status: 409 });
      }
      const row = await upsertExtracted({
        clientId,
        taxYear: manualYear,
        facts: emptyTaxReturnFacts(manualYear),
        warnings: ["Entered manually — no source document."],
        promptVersion: "manual",
        model: "manual",
        sourceFilename: "",
        vaultDocumentId: null,
      });
      await recordAudit({
        action: "tax_return.extract",
        resourceType: "tax_return",
        resourceId: `${clientId}:${manualYear}`,
        clientId,
        firmId,
        metadata: { taxYear: manualYear, manual: true },
      });
      return NextResponse.json({ taxYear: manualYear, status: row.status, warnings: row.warnings });
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large (25MB max)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = detectUploadKind(buffer);
    if (kind !== "pdf" && kind !== "png" && kind !== "jpeg") {
      return NextResponse.json(
        { error: "Tax return analysis accepts PDF or image uploads." },
        { status: 400 },
      );
    }
    const fileName = file instanceof File ? file.name : "tax-return.pdf";
    const replace = form.get("replace") === "true";
    const model = form.get("model") === "mini" ? ("mini" as const) : ("full" as const);

    let extraction;
    try {
      extraction = await extractTaxReturnFacts({ buffer, fileName, uploadKind: kind, model });
    } catch (err) {
      if (err instanceof TaxReturnExtractionError) {
        return NextResponse.json({ error: err.userMessage }, { status: 422 });
      }
      throw err;
    }

    const taxYear = extraction.facts.taxYear;
    const existing = await getTaxReturn(clientId, taxYear);
    if (existing && !replace) {
      return NextResponse.json({ error: "year_exists", taxYear }, { status: 409 });
    }

    // Best-effort: keep the source return with the client's documents.
    const vaultDoc = await savePlanToVault({
      clientId,
      firmId,
      reportType: "tax_return_source",
      scenarioId: null,
      filename: fileName,
      buffer,
      uploadedBy: userId,
    });

    const row = await upsertExtracted({
      clientId,
      taxYear,
      facts: extraction.facts,
      warnings: extraction.warnings,
      promptVersion: extraction.promptVersion,
      model,
      sourceFilename: fileName,
      vaultDocumentId: vaultDoc?.id ?? null,
    });

    await recordAudit({
      action: "tax_return.extract",
      resourceType: "tax_return",
      resourceId: `${clientId}:${taxYear}`,
      clientId,
      firmId,
      metadata: { taxYear, replaced: Boolean(existing), warnings: extraction.warnings.length },
    });

    return NextResponse.json({ taxYear, status: row.status, warnings: row.warnings });
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/tax-returns error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
