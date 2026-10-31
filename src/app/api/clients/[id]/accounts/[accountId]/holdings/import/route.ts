import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { importAccountHoldings } from "@/lib/investments/import-account-holdings";
import { parseBody } from "@/lib/schemas/common";
import { holdingsImportSchema } from "@/lib/schemas/holdings";
import { holdingsImportGate, refuseOverImportLimit } from "./gate";

export const dynamic = "force-dynamic";
// A 500-position sheet classifies each new ticker one by one.
export const maxDuration = 300;

/**
 * Write the positions the advisor reviewed — read off a spreadsheet or a
 * statement by the sibling routes — onto this account, replacing its holdings
 * or adding to them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id: clientId, accountId } = await params;
    const target = await holdingsImportGate(clientId, accountId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parsed = await parseBody(holdingsImportSchema, req);
    if (!parsed.ok) return parsed.response;
    // Each new ticker is classified and priced against the paid market-data
    // feed — the same bucket the import wizard's commit draws on.
    const refused = await refuseOverImportLimit(target.callerOrg, "commit");
    if (refused) return refused;
    const { source, mode, holdings } = parsed.data;

    await importAccountHoldings(accountId, holdings, mode);

    await recordAudit({
      action: "account.holdings.import",
      resourceType: "account",
      resourceId: accountId,
      clientId,
      firmId: target.firmId,
      metadata: crossFirmAuditMeta(target, target.callerOrg, { source, mode, count: holdings.length }),
    });

    return NextResponse.json({ imported: holdings.length });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings/import error:", err);
    return NextResponse.json({ error: "Couldn't import the holdings." }, { status: 500 });
  }
}
