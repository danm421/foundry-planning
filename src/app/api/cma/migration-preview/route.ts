import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { buildPreviewForFirm } from "@/lib/cma-migration-runner";

export const dynamic = "force-dynamic";

// GET /api/cma/migration-preview — diff between this firm's CMAs and the
// current standard 14-asset set. Drives the "Update to standard CMAs" dialog.
export async function GET() {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const preview = await buildPreviewForFirm(firmId);
    return NextResponse.json(preview);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp)
      return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/cma/migration-preview error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
