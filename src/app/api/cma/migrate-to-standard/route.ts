import { NextResponse, type NextRequest } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  migrateFirmToStandard,
  MigrationValidationError,
} from "@/lib/cma-migration-runner";
import type { Remapping } from "@/lib/cma-migration";

export const dynamic = "force-dynamic";

interface RemappingShape {
  kind?: unknown;
  toClassName?: unknown;
}

function parseRemappings(
  raw: unknown
): { remappings: Record<string, Remapping> } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "remappings must be an object keyed by old class id" };
  }
  const out: Record<string, Remapping> = {};
  for (const [k, v] of Object.entries(raw)) {
    const r = v as RemappingShape;
    if (!r || typeof r !== "object") {
      return { error: `remapping for ${k} is not an object` };
    }
    if (r.kind === "remap") {
      if (typeof r.toClassName !== "string" || r.toClassName.length === 0) {
        return { error: `remapping for ${k}: toClassName must be a non-empty string` };
      }
      out[k] = { kind: "remap", toClassName: r.toClassName };
    } else if (r.kind === "keep") {
      out[k] = { kind: "keep" };
    } else if (r.kind === "delete") {
      out[k] = { kind: "delete" };
    } else {
      return { error: `remapping for ${k}: unknown kind "${String(r.kind)}"` };
    }
  }
  return { remappings: out };
}

// POST /api/cma/migrate-to-standard — opt in this firm's CMAs to the standard
// 14-asset set. Body shape:
//   { remappings: { [oldClassId]: { kind: "remap", toClassId } | { kind: "keep" } | { kind: "delete" } } }
// One DB transaction; advisor-customized values & correlations are never
// overwritten (we only fill in missing pairs).
export async function POST(req: NextRequest) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();

    const body = (await req.json().catch(() => null)) as { remappings?: unknown } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = parseRemappings(body.remappings);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await migrateFirmToStandard(firmId, {
      remappings: parsed.remappings,
    });

    await recordAudit({
      action: "cma.migrate-to-standard",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: { result, remappings: parsed.remappings },
    });

    return NextResponse.json({ migrated: true, ...result });
  } catch (err) {
    if (err instanceof MigrationValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp)
      return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/migrate-to-standard error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
