// src/app/api/portal/savings-rules/route.ts
//
// Portal Organizer → Cash Flow, Savings band. The extra guard here that the
// income and expense routes do not need: the TARGET ACCOUNT must be
// portal-visible. Without it a client could fund a life-insurance policy or an
// engine cash bucket — accounts the portal deliberately never shows them —
// through an endpoint that only ever renders four categories.
//
// Delegates to the SAME write-core the advisor route uses
// (`@/lib/clients/savings-rules-writes`), so validation, FK scoping and audit
// cannot drift between the two tenants.
//
// No GET. The board is server-rendered from `loadOrganizerMap`; an unused read
// route on a client-facing surface is disclosure surface for nothing.
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { createSavingsRuleForClient } from "@/lib/clients/savings-rules-writes";
import { assertPortalVisibleTarget } from "@/lib/portal/assert-portal-visible-target";
import { assertPortalSavingsInput } from "@/lib/portal/portal-savings-input";
import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, firmId, actorId, actorKind, auditMeta } = await resolvePortalWriteContext();
    const input = (await req.json().catch(() => ({}))) as { accountId?: string };

    // The mode gate, on the create path. Without it a client can POST the very
    // shapes `isPortalWritableSavingsRule` refuses to let them edit — see
    // `portal-savings-input.ts`.
    const shape = assertPortalSavingsInput(input);
    if (!shape.ok) return NextResponse.json({ error: shape.error }, { status: shape.status });

    const target = await assertPortalVisibleTarget(clientId, input.accountId);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

    const result = await createSavingsRuleForClient({
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
