// The writability guard is re-derived from the DB ROW, never read off the
// request. Two gates, not one, and `isPortalWritableSavingsRule` owns both:
// the rule must resolve to a FLAT DOLLAR AMOUNT (a client typing a number over
// an IRS-max, percent-of-pay or scheduled rule types a number the projection
// discards), and its FUNDING ACCOUNT must be one the portal shows them.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savingsRules, savingsScheduleOverrides } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import {
  deleteSavingsRuleForClient,
  updateSavingsRuleForClient,
} from "@/lib/clients/savings-rules-writes";
import {
  assertPortalVisibleTarget,
  loadPortalAccountVisibility,
} from "@/lib/portal/assert-portal-visible-target";
import { isPortalWritableSavingsRule } from "@/lib/portal/portal-flow-writable";
import { assertPortalSavingsInput } from "@/lib/portal/portal-savings-input";
import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";

export const dynamic = "force-dynamic";

/** 404 for "not yours or not there", 403 for "yours but off-limits". The two
 *  are different answers and a client is entitled to tell them apart. */
async function loadWritable(
  clientId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  const [row] = await db
    .select({
      clientId: savingsRules.clientId,
      accountId: savingsRules.accountId,
      annualPercent: savingsRules.annualPercent,
      contributeMax: savingsRules.contributeMax,
    })
    .from(savingsRules)
    .where(and(eq(savingsRules.id, id), eq(savingsRules.clientId, clientId)))
    .limit(1);
  if (!row || row.clientId !== clientId) return { ok: false, status: 404 };

  // The predicate gets REAL inputs for BOTH its gates.
  //
  // The account map holds the rule's OWN funding account, read from the
  // accounts table. A hardcoded entry here would defeat the account gate
  // outright: `assertPortalVisibleTarget` below answers only for a NEW target
  // on a PUT that moves the rule, and DELETE never calls it at all. Since
  // `savingsRules.accountId` is an unrestricted FK, advisor-created rules
  // funding a 529 (`education_savings`) or a life-insurance policy are real
  // rows — and must stay off-limits from the portal. An account that does not
  // resolve leaves the map empty and the predicate refuses: fail closed.
  //
  // `scheduleOverrides` is its own table, not a column on the rule, so it is a
  // second read.
  const [visibility, scheduleRows] = await Promise.all([
    loadPortalAccountVisibility(clientId, row.accountId),
    db
      .select({
        year: savingsScheduleOverrides.year,
        amount: savingsScheduleOverrides.amount,
      })
      .from(savingsScheduleOverrides)
      .where(eq(savingsScheduleOverrides.savingsRuleId, id)),
  ]);

  const scheduleOverrides: Record<number, number> = {};
  for (const s of scheduleRows) scheduleOverrides[s.year] = Number(s.amount);

  const writable = isPortalWritableSavingsRule(
    {
      accountId: row.accountId,
      annualPercent: row.annualPercent != null ? Number(row.annualPercent) : null,
      contributeMax: row.contributeMax,
      scheduleOverrides,
    },
    new Map(visibility ? [[row.accountId, visibility]] : []),
  );
  if (!writable) return { ok: false, status: 403 };
  return { ok: true };
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, firmId, actorId, actorKind, auditMeta } = await resolvePortalWriteContext();
    const { id } = await ctx.params;

    const gate = await loadWritable(clientId, id);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.status === 404 ? "Not found" : "This contribution is managed by your advisor" },
        { status: gate.status },
      );
    }

    const input = (await req.json().catch(() => ({}))) as { accountId?: string };

    // Same DTO the create path enforces. `loadWritable` above only proves the
    // rule is writable TODAY; without this a client could edit it into a
    // contributeMax/percent-of-pay rule and lock themselves out of it for good.
    const shape = assertPortalSavingsInput(input);
    if (!shape.ok) return NextResponse.json({ error: shape.error }, { status: shape.status });

    if (input.accountId !== undefined) {
      const target = await assertPortalVisibleTarget(clientId, input.accountId);
      if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
    }

    const result = await updateSavingsRuleForClient({
      clientId,
      firmId,
      actorId,
      ruleId: id,
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
        { error: gate.status === 404 ? "Not found" : "This contribution is managed by your advisor" },
        { status: gate.status },
      );
    }

    const result = await deleteSavingsRuleForClient({
      clientId,
      firmId,
      actorId,
      ruleId: id,
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
