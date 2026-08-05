// src/app/api/portal/expenses/route.ts
//
// Portal Organizer → Cash Flow (Expenses band) AND Goals. There is no separate
// goals endpoint because a goal IS an expense carrying `isGoal` — the same
// column the advisor's "Show as a goal" checkbox writes. A create from the
// Goals tab posts here with `isGoal: true` and the row lands on both boards.
//
// Delegates to the SAME write-core the advisor route uses
// (`@/lib/clients/expenses-writes`), so validation, FK scoping, orphan-prune
// and audit cannot drift between the two tenants. The portal-specific parts
// are the guard (`resolvePortalWriteContext`) and the audit provenance it
// carries.
//
// No GET. The boards are server-rendered from `loadOrganizerMap`; an unused
// read route on a client-facing surface is disclosure surface for nothing.
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { createExpenseForClient } from "@/lib/clients/expenses-writes";
import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";
import { findRefusedFlowField } from "@/lib/portal/portal-write-dto";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, firmId, actorId, actorKind, auditMeta } = await resolvePortalWriteContext();
    const input = await req.json().catch(() => ({}));

    // Deny-list, not an allowlist: expenses carry far more legitimate fields
    // than savings does. See portal-write-dto.ts for why these fields are
    // refused rather than passed to the shared write-core.
    const refused = findRefusedFlowField(input);
    if (refused) {
      return NextResponse.json({ error: `${refused} cannot be set from the portal` }, { status: 400 });
    }

    const result = await createExpenseForClient({
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
