import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { listDocuments } from "@/lib/tax-returns/documents-store";
import { assembleTaxAnalysis, parseYear } from "@/lib/tax-returns/assemble-analysis";
import { MissingTaxReturnStateError } from "@/lib/tax-returns/errors";
import { loadDocumentSourceText } from "@/lib/tax-returns/second-read/source-text";
import { generateSecondRead } from "@/lib/tax-returns/second-read/generate";
import { putSecondRead } from "@/lib/tax-returns/second-read/store";
import { secondReadDocHash } from "@/lib/tax-returns/second-read/doc-hash";

export const dynamic = "force-dynamic";
// Re-reading every document out of the vault can involve OCR before the single
// analysis call, so this needs the same budget as the extraction routes.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
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
        { error: "Too many AI requests. Please wait and try again." },
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
        metadata: { reason: "ai_import_not_entitled", surface: "tax_return_second_read" },
      });
      return NextResponse.json({ error: "ai_import_not_entitled" }, { status: 403 });
    }

    const row = await getTaxReturn(clientId, taxYear);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [documents, assembled] = await Promise.all([
      listDocuments(row.id),
      assembleTaxAnalysis(clientId, taxYear),
    ]);
    if (!assembled?.facts) {
      return NextResponse.json(
        { error: "This year has no readable figures yet." },
        { status: 409 },
      );
    }

    const { sources, warnings } = await loadDocumentSourceText(documents);

    let read;
    try {
      read = await generateSecondRead({
        sources,
        facts: assembled.facts,
        findingHeadlines: (assembled.analysis?.findings ?? []).map((f) => f.headline),
        sourceWarnings: warnings,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("second read generation failed:", err);
      return NextResponse.json(
        { error: "The second read couldn't run right now. Try again in a moment." },
        { status: 502 },
      );
    }

    try {
      await putSecondRead(row.id, read, secondReadDocHash(documents.map((d) => d.id)));
    } catch (err) {
      if (err instanceof MissingTaxReturnStateError) {
        // Same refusal as adding a document: this year predates multi-document
        // support and has no state row, and creating one here would let the
        // next recompute blank the year.
        return NextResponse.json(
          {
            error: "not_converted",
            message:
              "This year predates multi-document support. Re-upload its Form 1040 to enable the AI second read.",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    await recordAudit({
      action: "tax_return.second_read",
      resourceType: "tax_return",
      resourceId: `${clientId}:${taxYear}`,
      clientId,
      firmId,
      metadata: { taxYear, itemCount: read.items.length, documentsRead: sources.length },
    });

    return NextResponse.json({ secondRead: read, secondReadStale: false });
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/tax-returns/[taxYear]/second-read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
