import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { deleteTaxReturn } from "@/lib/tax-returns/store";
import { saveReviewedFacts } from "@/lib/tax-returns/save-facts";
import { EmptyRecomputeError } from "@/lib/tax-returns/errors";
import { assembleTaxAnalysis, parseYear } from "@/lib/tax-returns/assemble-analysis";
import { taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";

export const dynamic = "force-dynamic";

// C1: reopen lets a `ready` return move back to needs_review (Task 13 "Edit
// facts"). reopen wins over markReady when both are somehow set.
const putBodySchema = z
  .object({ facts: taxReturnFactsSchema, markReady: z.boolean().optional(), reopen: z.boolean().optional() })
  .strict();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string }> },
) {
  try {
    await requireOrgId();
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const assembled = await assembleTaxAnalysis(id, taxYear);
    if (!assembled) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      taxYear: assembled.row.taxYear,
      status: assembled.row.status,
      facts: assembled.facts,
      extractedFacts: assembled.extractedFacts,
      warnings: assembled.row.warnings,
      factsParseError: assembled.parseError,
      analysis: assembled.analysis,
      documents: assembled.documentSummaries,
      conflicts: assembled.conflicts,
      provenance: assembled.provenance,
      documentsUnavailable: assembled.documentsUnavailable,
      secondRead: assembled.secondRead,
      secondReadStale: assembled.secondReadStale,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/tax-returns/[taxYear] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string }> },
) {
  try {
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    await requireOrgId();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = putBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid facts" },
        { status: 400 },
      );
    }
    if (parsed.data.facts.taxYear !== taxYear) {
      return NextResponse.json(
        { error: "Facts tax year does not match the URL." },
        { status: 400 },
      );
    }
    const nextStatus = parsed.data.reopen ? "needs_review" : parsed.data.markReady ? "ready" : undefined;
    let saved;
    try {
      saved = await saveReviewedFacts({
        clientId: id,
        taxYear,
        submitted: parsed.data.facts,
        nextStatus,
      });
    } catch (err) {
      if (err instanceof EmptyRecomputeError) {
        // Same refusal as removing the last document (Task 7): this return
        // has no documents, so its data lives only in overrides, and saving
        // with everything blank would erase the only copy. The advisor
        // deletes the YEAR if that is what they meant.
        return NextResponse.json(
          {
            error: "empty_return",
            message:
              "This year has no supporting documents, so its data lives only in these fields. Saving with everything blank would erase it. Delete the year instead if that's what you want.",
          },
          { status: 409 },
        );
      }
      throw err;
    }
    if (!saved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await recordAudit({
      action: "tax_return.update",
      resourceType: "tax_return",
      resourceId: `${id}:${taxYear}`,
      clientId: id,
      firmId,
      metadata: { taxYear, markReady: parsed.data.markReady === true, reopen: parsed.data.reopen === true },
    });
    return NextResponse.json({ taxYear: saved.taxYear, status: saved.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/tax-returns/[taxYear] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string }> },
) {
  try {
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    await requireOrgId();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const deleted = await deleteTaxReturn(id, taxYear);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await recordAudit({
      action: "tax_return.delete",
      resourceType: "tax_return",
      resourceId: `${id}:${taxYear}`,
      clientId: id,
      firmId,
      metadata: { taxYear },
    });
    // The source PDF stays in the CRM vault by design — deleting the analysis
    // shouldn't delete the client's document.
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/tax-returns/[taxYear] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
