// The writability guard is re-derived from the DB ROW, never read off the
// request. A hand-rolled PUT against a social-security id must 403 rather than
// silently wipe a "claim at 70" strategy through a form that never rendered it.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { incomes } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { deleteIncomeForClient, updateIncomeForClient } from "@/lib/clients/incomes-writes";
import { isPortalWritableIncome } from "@/lib/portal/portal-flow-writable";
import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";
import { findRefusedFlowField } from "@/lib/portal/portal-write-dto";
import type { Income } from "@/engine/types";

export const dynamic = "force-dynamic";

/** 404 for "not yours or not there", 403 for "yours but off-limits". The two
 *  are different answers and a client is entitled to tell them apart. */
async function loadWritable(
  clientId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  const [row] = await db
    .select({
      clientId: incomes.clientId,
      source: incomes.source,
      type: incomes.type,
      ownerEntityId: incomes.ownerEntityId,
      ownerAccountId: incomes.ownerAccountId,
    })
    .from(incomes)
    .where(and(eq(incomes.id, id), eq(incomes.clientId, clientId)))
    .limit(1);
  if (!row || row.clientId !== clientId) return { ok: false, status: 404 };
  // The DB's `source` column is the shared sourceEnum (also used by accounts,
  // synced from Plaid/Orion/Schwab/Addepar); Income.source is narrower
  // ("manual" | "extracted" | "policy") because no income row is ever
  // custodian-synced. ownerEntityId/ownerAccountId are nullable columns vs.
  // Income's optional-undefined convention. Normalize both before handing the
  // row to the shared predicate.
  const income: Pick<Income, "source" | "type" | "ownerEntityId" | "ownerAccountId"> = {
    source: row.source as Income["source"],
    type: row.type,
    ownerEntityId: row.ownerEntityId ?? undefined,
    ownerAccountId: row.ownerAccountId ?? undefined,
  };
  if (!isPortalWritableIncome(income)) return { ok: false, status: 403 };
  return { ok: true };
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, firmId, actorId, actorKind, auditMeta } = await resolvePortalWriteContext();
    const { id } = await ctx.params;

    const gate = await loadWritable(clientId, id);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.status === 404 ? "Not found" : "This row is managed by your advisor" },
        { status: gate.status },
      );
    }

    const input = await req.json().catch(() => ({}));

    // Applied AFTER the gate above: a probe against a row the client cannot
    // touch must still get the gate's 403/404, not a 400 that leaks the row's
    // existence. See portal-write-dto.ts.
    const refused = findRefusedFlowField(input);
    if (refused) {
      return NextResponse.json({ error: `${refused} cannot be set from the portal` }, { status: 400 });
    }

    const result = await updateIncomeForClient({
      clientId,
      firmId,
      actorId,
      incomeId: id,
      input,
      crossFirmMeta: auditMeta,
      actorKind,
    });
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId, firmId, actorId, actorKind, auditMeta } = await resolvePortalWriteContext();
    const { id } = await ctx.params;

    const gate = await loadWritable(clientId, id);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.status === 404 ? "Not found" : "This row is managed by your advisor" },
        { status: gate.status },
      );
    }

    const result = await deleteIncomeForClient({
      clientId,
      firmId,
      actorId,
      incomeId: id,
      crossFirmMeta: auditMeta,
      actorKind,
    });
    return result.ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
