import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authErrorResponse } from "@/lib/authz";
import { requireAiAvailableForFirm, withAiForFirm } from "@/lib/ai/resolve";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { extractDocument } from "@/lib/extraction/extract";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { refuseUnlessAiImportEntitled } from "@/lib/imports/ai-import-gate";
import { toStatementRead } from "@/lib/investments/holdings-import";
import { parseBody } from "@/lib/schemas/common";
import { holdingsStatementReadSchema } from "@/lib/schemas/holdings";
import { StagedUploadError, stagingPrefix, takeStagedUpload } from "@/lib/uploads/staged-upload";
import { holdingsImportGate, refuseOverImportLimit } from "../gate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Read positions off a statement the browser staged in Blob (step 2 of
 * `@/lib/uploads/staged-upload`), with the same AI read the import wizard
 * runs. Writes nothing: the advisor picks the statement's account and reviews
 * its positions, then the import route saves them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id: clientId, accountId } = await params;
    const target = await holdingsImportGate(clientId, accountId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = await parseBody(holdingsStatementReadSchema, req);
    if (!parsed.ok) return parsed.response;
    // Taken before any refusal below, so the staged copy is always deleted.
    const buffer = await takeStagedUpload(stagingPrefix("holdings-statement", clientId), parsed.data.stagedPathname);

    await requireAiAvailableForFirm(target.firmId);
    const { sessionClaims } = await auth();
    const denied = await refuseUnlessAiImportEntitled({
      sessionClaims,
      firmId: target.callerOrg,
      clientId,
      metadata: { surface: "account_holdings_statement" },
    });
    if (denied) return denied;
    const refused = await refuseOverImportLimit(target.callerOrg, "extract");
    if (refused) return refused;

    const kind = detectUploadKind(buffer);
    if (!kind) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, Word, Excel, CSV, or image (PNG/JPEG) file." },
        { status: 400 },
      );
    }

    // A statement for this client: read under the client's firm, not the caller's org.
    const result = await withAiForFirm(target.firmId, () =>
      extractDocument(buffer, parsed.data.filename, "account_statement", "mini", kind, /* extractHoldings */ true),
    );

    const read = toStatementRead(result.extracted.accounts, target.account.last4, [...result.warnings]);

    await recordAudit({
      action: "account.holdings.statement_read",
      resourceType: "account",
      resourceId: accountId,
      clientId,
      firmId: target.firmId,
      metadata: crossFirmAuditMeta(target, target.callerOrg, {
        fileName: parsed.data.filename,
        kind,
        accountCount: read.accounts.length,
        holdingCount: read.accounts.reduce((s, a) => s + a.holdings.length, 0),
      }),
    });

    return NextResponse.json(read);
  } catch (err) {
    if (err instanceof StagedUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings/import/statement error:", err);
    return NextResponse.json({ error: "Couldn't read holdings from that statement." }, { status: 500 });
  }
}
