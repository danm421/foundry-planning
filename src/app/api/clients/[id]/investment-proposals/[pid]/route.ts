import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { investmentProposals } from "@/db/schema";
import { parseBody } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { proposalUpdateSchema, type ProposalCreateInput } from "@/lib/investments/proposals/schemas";
import { computeProposalSnapshot } from "@/lib/investments/proposals/compute";
import { getProposal } from "@/lib/investments/proposals/queries";
import { UnclassifiableTickerError } from "@/lib/investments/rebalance/resolve-target";

export const dynamic = "force-dynamic";
// A PUT with `recompute: true` runs the same rebalance compute — and the same
// projection — the create route does, so it needs the same ceiling.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; pid: string }> };

/** Drizzle decimal columns take strings; a raw number silently rounds. */
const dec = (v: number | null) => (v == null ? null : String(v));

/** Inputs the frozen snapshot was computed from. Changing any of them without
 *  recomputing would leave `result` describing a portfolio the row no longer
 *  names — a proposal that presents Core Moderate's numbers under Core
 *  Aggressive's label, with nothing marking it stale. */
const SNAPSHOT_INPUT_KEYS = ["source", "target", "overrideLtcgRate"] as const;

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireOrgId();
    const { id, pid } = await params;

    // Reading is legitimate for a view-only share recipient, so this gates on
    // `ok` alone — unlike PUT and DELETE below.
    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // `getProposal` filters on clientId, so another client's proposal resolves
    // null — deliberately indistinguishable from one that never existed.
    const proposal = await getProposal(id, pid);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ proposal });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /clients/[id]/investment-proposals/[pid]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const callerOrg = await requireOrgId();
    const { id, pid } = await params;

    // A cross-firm share can be granted read-only; editing needs edit.
    const access = await verifyClientAccess(id);
    if (!access.ok || access.permission !== "edit") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = await parseBody(proposalUpdateSchema, request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const changedInputs = SNAPSHOT_INPUT_KEYS.filter((k) => body[k] !== undefined);
    if (changedInputs.length > 0 && !body.recompute) {
      return NextResponse.json(
        {
          error: `Changing ${changedInputs.join(", ")} requires recompute: true — the stored result would no longer describe these inputs.`,
        },
        { status: 400 },
      );
    }

    const existing = await getProposal(id, pid);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // `undefined` means "not supplied"; an explicit null clears the column, so
    // these cannot collapse to `??`. (They are `.nullable().optional()` rather
    // than `.default(null)` precisely so this distinction survives `.partial()`.)
    const advisoryFeeCurrent =
      body.advisoryFeeCurrent !== undefined ? body.advisoryFeeCurrent : existing.advisoryFeeCurrent;
    const advisoryFeeProposed =
      body.advisoryFeeProposed !== undefined ? body.advisoryFeeProposed : existing.advisoryFeeProposed;
    const overrideLtcgRate =
      body.overrideLtcgRate !== undefined ? body.overrideLtcgRate : existing.overrideLtcgRate;

    // `updated_at` carries no `$onUpdate` and `investment_proposals_client_idx`
    // sorts the advisor's list on it, so an edit that doesn't stamp it leaves
    // the proposal sitting at its old position.
    const patch: Partial<typeof investmentProposals.$inferInsert> = {
      updatedAt: new Date(),
      advisoryFeeCurrent: dec(advisoryFeeCurrent),
      advisoryFeeProposed: dec(advisoryFeeProposed),
      overrideLtcgRate: dec(overrideLtcgRate),
    };
    if (body.name !== undefined) patch.name = body.name;
    if (body.status !== undefined) patch.status = body.status;
    if (body.source !== undefined) patch.source = body.source;
    if (body.target !== undefined) patch.target = body.target;
    if (body.targetLabel !== undefined) patch.targetLabel = body.targetLabel;
    if (body.notes !== undefined) patch.notes = body.notes;

    let result = existing.result;
    let computedAt = existing.computedAt;
    if (body.recompute) {
      // Rebuild from the merged inputs: what this request supplied, falling back
      // to what the proposal already held. The stored jsonb was written through
      // these same schemas, hence the cast.
      const source = body.source ?? (existing.source as ProposalCreateInput["source"]);
      const target = body.target ?? (existing.target as ProposalCreateInput["target"]);

      computedAt = new Date();
      result = await computeProposalSnapshot({
        clientId: id,
        firmId: access.firmId,
        request: { ...source, target,
          ...(overrideLtcgRate != null ? { overrideLtcgRate } : {}) },
        advisoryFeeCurrent,
        advisoryFeeProposed,
        computedAt,
      });
      patch.result = result;
      patch.computedAt = computedAt;
    }

    await db
      .update(investmentProposals)
      .set(patch)
      .where(and(eq(investmentProposals.clientId, id), eq(investmentProposals.id, pid)));

    await recordAudit({
      action: "investment_proposal.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        proposalId: pid,
        recomputed: body.recompute,
      }),
    });

    return NextResponse.json({ id: pid, result, computedAt });
  } catch (err) {
    // Same status and body shape as the rebalance/compute route: the advisor
    // needs the ticker list back to fix it, not "Internal server error".
    if (err instanceof UnclassifiableTickerError) {
      return NextResponse.json(
        { error: err.message, unresolvedTickers: err.tickers },
        { status: 422 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /clients/[id]/investment-proposals/[pid]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const callerOrg = await requireOrgId();
    const { id, pid } = await params;

    // A cross-firm share can be granted read-only; deleting needs edit.
    const access = await verifyClientAccess(id);
    if (!access.ok || access.permission !== "edit") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existing = await getProposal(id, pid);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db
      .delete(investmentProposals)
      .where(and(eq(investmentProposals.clientId, id), eq(investmentProposals.id, pid)));

    await recordAudit({
      action: "investment_proposal.delete",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        proposalId: pid,
        name: existing.name,
      }),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("DELETE /clients/[id]/investment-proposals/[pid]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
