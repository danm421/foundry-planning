// Portal Organizer → Cash Flow, Income band. Delegates to the SAME write-core
// the advisor route uses (`@/lib/clients/incomes-writes`), so validation, FK
// scoping, orphan-prune and audit cannot drift between the two tenants. The
// portal-specific parts are the guard (`resolvePortalWriteContext`) and the
// audit provenance it carries.
//
// No GET. The boards are server-rendered from `loadOrganizerMap`; an unused
// read route on a client-facing surface is disclosure surface for nothing.
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { createIncomeForClient } from "@/lib/clients/incomes-writes";
import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";
import { findRefusedFlowField } from "@/lib/portal/portal-write-dto";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, firmId, actorId, actorKind, auditMeta } = await resolvePortalWriteContext();
    const input = await req.json().catch(() => ({}));

    // Deny-list, not an allowlist: incomes carry far more legitimate fields
    // than savings does. See portal-write-dto.ts for why these five specific
    // fields are refused rather than passed to the shared write-core.
    const refused = findRefusedFlowField(input);
    if (refused) {
      return NextResponse.json({ error: `${refused} cannot be set from the portal` }, { status: 400 });
    }

    const result = await createIncomeForClient({
      clientId,
      firmId,
      actorId,
      input,
      crossFirmMeta: auditMeta,
      actorKind,
    });
    return result.ok
      ? NextResponse.json({ ok: true, id: result.resourceId }, { status: 201 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
