import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { investmentProposals } from "@/db/schema";
import { parseBody } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { proposalCreateSchema } from "@/lib/investments/proposals/schemas";
import { computeProposalSnapshot } from "@/lib/investments/proposals/compute";
import { listProposals } from "@/lib/investments/proposals/queries";
import { UnclassifiableTickerError } from "@/lib/investments/rebalance/resolve-target";

export const dynamic = "force-dynamic";
// Creating a proposal runs the rebalance compute, which runs a projection to
// derive the effective LTCG rate — the same compute class as the solver routes,
// and 60s starves it on prod.
export const maxDuration = 300;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrgId();
    const { id } = await params;
    // Reading is legitimate for a view-only share recipient, so this gates on
    // `ok` alone — unlike POST below.
    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ proposals: await listProposals(id) });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /clients/[id]/investment-proposals", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const callerOrg = await requireOrgId();
    const { id } = await params;

    // A cross-firm share can be granted read-only; creating a proposal is a
    // mutation, so it needs edit. Same 404 body as a missing client — a
    // view-only recipient learns nothing from the difference.
    const access = await verifyClientAccess(id);
    if (!access.ok || access.permission !== "edit") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = await parseBody(proposalCreateSchema, request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // The optional inputs are `.nullable().optional()` so `.partial()` works on
    // the update schema; the create side settles them to null here.
    const advisoryFeeCurrent = body.advisoryFeeCurrent ?? null;
    const advisoryFeeProposed = body.advisoryFeeProposed ?? null;
    const overrideLtcgRate = body.overrideLtcgRate ?? null;

    const computedAt = new Date();
    const snapshot = await computeProposalSnapshot({
      clientId: id,
      firmId: access.firmId,
      request: { ...body.source, target: body.target,
        ...(overrideLtcgRate != null ? { overrideLtcgRate } : {}) },
      advisoryFeeCurrent,
      advisoryFeeProposed,
      computedAt,
    });

    // Drizzle decimal columns take strings; a raw number silently rounds.
    const dec = (v: number | null) => (v == null ? null : String(v));

    const [row] = await db
      .insert(investmentProposals)
      .values({
        firmId: access.firmId,
        clientId: id,
        name: body.name,
        source: body.source,
        target: body.target,
        targetLabel: body.targetLabel,
        advisoryFeeCurrent: dec(advisoryFeeCurrent),
        advisoryFeeProposed: dec(advisoryFeeProposed),
        overrideLtcgRate: dec(overrideLtcgRate),
        notes: body.notes ?? null,
        result: snapshot,
        computedAt,
        // The Clerk user id, NOT callerOrg — `requireOrgId` returns the
        // organization, and storing that in createdBy would make every
        // proposal in a firm look like it had the same author.
        createdBy: (await auth()).userId ?? null,
      })
      .returning({ id: investmentProposals.id });

    await recordAudit({
      action: "investment_proposal.create",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        proposalId: row.id,
        targetLabel: body.targetLabel,
      }),
    });

    return NextResponse.json({ id: row.id, result: snapshot, computedAt });
  } catch (err) {
    // A ticker-list target can name something the loader can't classify. The
    // advisor needs the ticker list back to fix it, not "Internal server error"
    // — same status and body shape as the rebalance/compute route.
    if (err instanceof UnclassifiableTickerError) {
      return NextResponse.json(
        { error: err.message, unresolvedTickers: err.tickers },
        { status: 422 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /clients/[id]/investment-proposals", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
