import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import {
  getTaxReturn, getPriorTaxReturn, updateFacts, deleteTaxReturn,
} from "@/lib/tax-returns/store";
import { parseRowFacts } from "@/lib/tax-returns/db";
import { loadAnalysisContext } from "@/lib/tax-returns/load-analysis-context";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";

export const dynamic = "force-dynamic";

// C1: reopen lets a `ready` return move back to needs_review (Task 13 "Edit
// facts"). reopen wins over markReady when both are somehow set.
const putBodySchema = z
  .object({ facts: taxReturnFactsSchema, markReady: z.boolean().optional(), reopen: z.boolean().optional() })
  .strict();

function parseYear(raw: string): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

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

    const row = await getTaxReturn(id, taxYear);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { facts, extractedFacts, parseError } = parseRowFacts(row);
    let analysis = null;
    if (facts) {
      const [ctx, priorRow] = await Promise.all([
        loadAnalysisContext(id, taxYear),
        getPriorTaxReturn(id, taxYear),
      ]);
      const prior = priorRow ? parseRowFacts(priorRow).facts : null;
      analysis = buildTaxAnalysis({
        facts, prior,
        resolver: ctx.resolver,
        primaryAge: ctx.primaryAge,
        spouseAge: ctx.spouseAge,
      });
    }
    return NextResponse.json({
      taxYear: row.taxYear,
      status: row.status,
      facts,
      extractedFacts,
      warnings: row.warnings,
      factsParseError: parseError,
      analysis,
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
    const row = await updateFacts(id, taxYear, parsed.data.facts, nextStatus);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await recordAudit({
      action: "tax_return.update",
      resourceType: "tax_return",
      resourceId: `${id}:${taxYear}`,
      clientId: id,
      firmId,
      metadata: { taxYear, markReady: parsed.data.markReady === true, reopen: parsed.data.reopen === true },
    });
    return NextResponse.json({ taxYear: row.taxYear, status: row.status });
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
