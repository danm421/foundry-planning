// POST: generate Markdown client commentary for the Investment Proposal page.
// Auth, the firm-keyed extract rate limit, and audit live here; the prompt →
// Redis → Azure call is in generateInvestmentProposalAi, shared with the
// background presentation run.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  generateInvestmentProposalAi,
  ProposalNotFoundError,
} from "@/lib/presentations/pages/investment-proposal/generate-ai";

export const dynamic = "force-dynamic";
// No projection and no Monte Carlo behind this one — the snapshot is frozen —
// so the default duration is ample. Kept explicit for parity with its sibling.
export const maxDuration = 120;

const Body = z.object({
  proposalId: z.string().uuid(),
  firstNames: z.string().max(200).default(""),
  tone: z.enum(["concise", "detailed", "plain"]),
  length: z.enum(["short", "medium", "long"]),
  customInstructions: z.string().max(2000).default(""),
  force: z.boolean().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const callerOrg = await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Same gate presentations/runs puts in front of this same Azure call.
    // After the access check so a cross-firm probe still 404s instead of
    // leaking a billing state; before the rate limit so a lapsed firm never
    // burns budget. Throws — the catch below returns it as a 403.
    await requireActiveSubscriptionForFirm(access.firmId);

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const rl = await checkExtractRateLimit(callerOrg);
    if (!rl.allowed) return rateLimitErrorResponse(rl, "AI analysis rate limit exceeded");

    const { markdown, generatedAt, cached, hash } = await generateInvestmentProposalAi({
      clientId: id,
      firmId: access.firmId,
      proposalId: body.proposalId,
      firstNames: body.firstNames,
      tone: body.tone,
      length: body.length,
      customInstructions: body.customInstructions,
      force: body.force,
    });

    await recordAudit({
      // Reuse the existing AI-commentary action; the closed AuditAction union has
      // no proposal-specific value. `surface` distinguishes it.
      action: "comparison.ai_generate",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        surface: "presentations.investment_proposal",
        proposalId: body.proposalId,
        tone: body.tone,
        length: body.length,
        cached,
      }),
    });

    return NextResponse.json({ markdown, generatedAt, cached, hash });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/presentations/investment-proposal-ai error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
