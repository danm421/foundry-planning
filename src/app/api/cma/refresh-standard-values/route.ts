import { NextResponse, type NextRequest } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  refreshFirmStandardValues,
  ValueRefreshError,
} from "@/lib/cma-value-refresh-runner";

export const dynamic = "force-dynamic";

function parseBody(
  raw: unknown,
): { classIds: string[]; refreshCorrelations: boolean } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid JSON body" };
  const body = raw as { classIds?: unknown; refreshCorrelations?: unknown };
  if (
    !Array.isArray(body.classIds) ||
    !body.classIds.every((x) => typeof x === "string")
  ) {
    return { error: "classIds must be an array of strings" };
  }
  if (typeof body.refreshCorrelations !== "boolean") {
    return { error: "refreshCorrelations must be a boolean" };
  }
  return { classIds: body.classIds, refreshCorrelations: body.refreshCorrelations };
}

// POST /api/cma/refresh-standard-values — adopt the recomputed standard values
// for the selected asset classes and (optionally) the full standard correlation
// matrix. Body: { classIds: string[], refreshCorrelations: boolean }.
export async function POST(req: NextRequest) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();

    const raw = await req.json().catch(() => null);
    const parsed = parseBody(raw);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await refreshFirmStandardValues(firmId, parsed);

    await recordAudit({
      action: "cma.refresh-standard-values",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: {
        result,
        classIds: parsed.classIds,
        refreshCorrelations: parsed.refreshCorrelations,
      },
    });

    return NextResponse.json({ refreshed: true, ...result });
  } catch (err) {
    if (err instanceof ValueRefreshError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/refresh-standard-values error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
