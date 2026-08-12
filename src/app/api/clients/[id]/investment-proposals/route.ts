import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/db";
import { investmentProposals } from "@/db/schema";
import { formatZodIssues } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { proposalCreateSchema } from "@/lib/investments/proposals/schemas";
import { computeProposalSnapshot } from "@/lib/investments/proposals/compute";
import { listProposals } from "@/lib/investments/proposals/queries";

export const dynamic = "force-dynamic";
// Creating a proposal runs the rebalance compute, which runs a projection to
// derive the effective LTCG rate — the same compute class as the solver routes,
// and 60s starves it on prod.
export const maxDuration = 300;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrgId();
    const { id } = await params;
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

    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parsed = proposalCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const computedAt = new Date();
    const snapshot = await computeProposalSnapshot({
      clientId: id,
      firmId: access.firmId,
      request: { ...body.source, target: body.target,
        ...(body.overrideLtcgRate != null ? { overrideLtcgRate: body.overrideLtcgRate } : {}) },
      advisoryFeeCurrent: body.advisoryFeeCurrent,
      advisoryFeeProposed: body.advisoryFeeProposed,
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
        advisoryFeeCurrent: dec(body.advisoryFeeCurrent),
        advisoryFeeProposed: dec(body.advisoryFeeProposed),
        overrideLtcgRate: dec(body.overrideLtcgRate),
        notes: body.notes,
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
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(err) },
        { status: 400 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /clients/[id]/investment-proposals", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
