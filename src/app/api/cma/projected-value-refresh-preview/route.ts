import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { buildProjectedValueRefreshPreviewForFirm } from "@/lib/cma-projected-value-refresh-runner";

export const dynamic = "force-dynamic";

// GET /api/cma/projected-value-refresh-preview — diff between this firm's
// projected CMA values and cma-projected.generated.json. Drives the "Refresh
// projected values" dialog.
export async function GET() {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const preview = await buildProjectedValueRefreshPreviewForFirm(firmId);
    return NextResponse.json(preview);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/cma/projected-value-refresh-preview error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
