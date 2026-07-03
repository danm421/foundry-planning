// POST: generate Markdown advisor commentary for the Retirement Comparison
// presentation page. Auth, the firm-keyed extract rate limit, and audit live
// here; the projection → Monte Carlo → prompt → Redis-cached Azure call is in
// generateRetirementComparisonAi, shared with the background presentation run.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { generateRetirementComparisonAi } from "@/lib/presentations/pages/retirement-comparison/generate-ai";

export const dynamic = "force-dynamic";
// Runs the retirement-comparison projection + MC behind the AI commentary —
// same compute class as the solver routes, so 60s starves it on prod.
export const maxDuration = 300;

const Body = z.object({
  scenarioId: z.string().min(1),
  tone: z.enum(["concise", "detailed", "plain"]),
  length: z.enum(["short", "medium", "long"]),
  customInstructions: z.string().max(2000).default(""),
  force: z.boolean().default(false),
  targetConfidence: z.number().min(0.5).max(0.99).default(0.85),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const callerOrg = await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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

    const { markdown, generatedAt, cached, hash } = await generateRetirementComparisonAi({
      clientId: id,
      firmId: access.firmId,
      scenarioId: body.scenarioId,
      tone: body.tone,
      length: body.length,
      customInstructions: body.customInstructions,
      targetConfidence: body.targetConfidence,
      force: body.force,
    });

    await recordAudit({
      // Reuse the existing AI-commentary action; the closed AuditAction union
      // has no retirement-comparison-specific value and we don't edit helpers
      // here. `surface` in metadata distinguishes it from the comparison tool.
      action: "comparison.ai_generate",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        surface: "presentations.retirement_comparison",
        scenarioId: body.scenarioId,
        tone: body.tone,
        length: body.length,
        force: body.force,
        cached,
      }),
    });

    return NextResponse.json({ markdown, generatedAt, cached, hash });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(err) },
        { status: 400 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST presentations/retirement-comparison-ai", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
