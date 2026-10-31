import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { authErrorResponse } from "@/lib/authz";
import { refuseUnlessAiImportEntitled } from "@/lib/imports/ai-import-gate";
import { parseBody } from "@/lib/schemas/common";
import { issueStagedUpload, stagingPrefix } from "@/lib/uploads/staged-upload";
import { holdingsImportGate } from "../../gate";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ filename: z.string().trim().min(1).max(255) }).strict();

/** Step 1 of a statement import (`@/lib/uploads/staged-upload`): a one-file
 *  Blob token, for the statement route to read back. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id: clientId, accountId } = await params;
    const target = await holdingsImportGate(clientId, accountId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { sessionClaims } = await auth();
    const denied = await refuseUnlessAiImportEntitled({
      sessionClaims,
      firmId: target.callerOrg,
      clientId,
      metadata: { surface: "account_holdings_statement_upload" },
    });
    if (denied) return denied;

    const parsed = await parseBody(BodySchema, req);
    if (!parsed.ok) return parsed.response;

    return NextResponse.json(
      await issueStagedUpload(stagingPrefix("holdings-statement", clientId), parsed.data.filename),
    );
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings/import/statement/upload-token error:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
