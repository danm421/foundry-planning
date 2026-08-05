// The writability guard is re-derived from the DB ROW, never read off the
// request. A hand-rolled PUT against a synthesized policy-premium id must
// 403 rather than silently rewrite a row that has no real backing.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { deleteExpenseForClient, updateExpenseForClient } from "@/lib/clients/expenses-writes";
import { isPortalWritableExpense } from "@/lib/portal/portal-flow-writable";
import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";
import type { Expense } from "@/engine/types";

export const dynamic = "force-dynamic";

/** 404 for "not yours or not there", 403 for "yours but off-limits". The two
 *  are different answers and a client is entitled to tell them apart. */
async function loadWritable(
  clientId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  const [row] = await db
    .select({
      clientId: expenses.clientId,
      source: expenses.source,
      ownerEntityId: expenses.ownerEntityId,
      ownerAccountId: expenses.ownerAccountId,
    })
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.clientId, clientId)))
    .limit(1);
  if (!row || row.clientId !== clientId) return { ok: false, status: 404 };
  // The DB's `source` column is the shared sourceEnum (also used by accounts,
  // synced from Plaid/Orion/Schwab/Addepar); Expense.source is narrower
  // ("manual" | "extracted" | "policy") because no expense row is ever
  // custodian-synced. ownerEntityId/ownerAccountId are nullable columns vs.
  // Expense's optional-undefined convention. Normalize both before handing the
  // row to the shared predicate.
  const expense: Pick<Expense, "source" | "ownerEntityId" | "ownerAccountId"> = {
    source: row.source as Expense["source"],
    ownerEntityId: row.ownerEntityId ?? undefined,
    ownerAccountId: row.ownerAccountId ?? undefined,
  };
  if (!isPortalWritableExpense(expense)) return { ok: false, status: 403 };
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

    const result = await updateExpenseForClient({
      clientId,
      firmId,
      actorId,
      expenseId: id,
      input: await req.json().catch(() => ({})),
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

    const result = await deleteExpenseForClient({
      clientId,
      firmId,
      actorId,
      expenseId: id,
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
