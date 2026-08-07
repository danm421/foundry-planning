import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { deleteDocument, insertDocument } from "@/lib/tax-returns/documents-store";
import { recomputeFacts } from "@/lib/tax-returns/recompute";
import { EmptyRecomputeError } from "@/lib/tax-returns/errors";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string; documentId: string }> },
) {
  try {
    const { id, taxYear: rawYear, documentId } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    await requireOrgId();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const row = await getTaxReturn(id, taxYear);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Scoped to the return id inside `deleteDocument` itself — a request
    // authz'd for one return can never delete another's document row.
    const removed = await deleteDocument(row.id, documentId);
    if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
      await recomputeFacts(row.id, taxYear);
    } catch (err) {
      // The document is already gone (`deleteDocument` committed above), but
      // a refusal here — or any other recompute failure — must not leave the
      // return with zero documents while telling the advisor the delete
      // didn't happen. Restore it from the row `deleteDocument` handed back:
      // `.returning()` already carries every field `insertDocument` needs, so
      // no re-extraction is required. Mirrors `add-document.ts`'s
      // compensating delete on a failed recompute, in the opposite
      // direction. The restored row gets a new `id`/`created_at`; nothing
      // persisted depends on either staying stable. A failure of this
      // restoring insert is swallowed so it can't mask the original error.
      try {
        await insertDocument({
          taxReturnId: removed.taxReturnId,
          role: removed.role,
          filename: removed.filename,
          vaultDocumentId: removed.vaultDocumentId,
          extractedFacts: removed.extractedFacts,
          supportingPayload: removed.supportingPayload,
          warnings: removed.warnings,
          promptVersion: removed.promptVersion,
          model: removed.model,
          taxYear: removed.taxYear,
        });
      } catch {
        // swallow — the original recompute error is what the caller needs to see
      }

      if (err instanceof EmptyRecomputeError) {
        // Zero documents AND zero overrides merges to all-nulls, which would
        // blank a filed return. Refusing is the honest outcome: the advisor
        // deletes the YEAR if that is what they meant.
        return NextResponse.json(
          {
            error: "last_document",
            message:
              "That's the only document left for this year, and removing it would leave the year blank. Delete the year instead if that's what you want.",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    await recordAudit({
      action: "tax_return.document_remove",
      resourceType: "tax_return",
      resourceId: `${id}:${taxYear}`,
      clientId: id,
      firmId,
      metadata: { taxYear, documentId },
    });

    return NextResponse.json({ removed: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/tax-returns/[taxYear]/documents/[documentId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
