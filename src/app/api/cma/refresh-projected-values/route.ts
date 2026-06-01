import { NextResponse, type NextRequest } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  refreshFirmProjectedValues,
  ProjectedValueRefreshError,
} from "@/lib/cma-projected-value-refresh-runner";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): { classIds: string[] } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid JSON body" };
  const body = raw as { classIds?: unknown };
  if (!Array.isArray(body.classIds) || !body.classIds.every((x) => typeof x === "string")) {
    return { error: "classIds must be an array of strings" };
  }
  return { classIds: body.classIds };
}

// POST /api/cma/refresh-projected-values — adopt the generated projected values
// for the selected asset classes. Body: { classIds: string[] }.
export async function POST(req: NextRequest) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();

    const raw = await req.json().catch(() => null);
    const parsed = parseBody(raw);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await refreshFirmProjectedValues(firmId, parsed);

    await recordAudit({
      action: "cma.refresh-projected-values",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: { result, classIds: parsed.classIds },
    });

    return NextResponse.json({ refreshed: true, ...result });
  } catch (err) {
    if (err instanceof ProjectedValueRefreshError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/refresh-projected-values error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
