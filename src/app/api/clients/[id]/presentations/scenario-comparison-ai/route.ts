// POST: generate the per-scenario tradeoff narratives for the Scenario
// Comparison presentation page. Auth, the firm-keyed extract rate limit, and
// audit live here; the load → view model → prompt → Redis-cached Azure call is
// in generate-ai.ts, shared with the background presentation run.
//
// One request writes every chosen scenario's paragraph: the advisor asks for
// the sheet, not for one column of it.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import {
  generateScenarioComparisonAi,
  prepareScenarioComparisonAiInputs,
} from "@/lib/presentations/pages/scenario-comparison/generate-ai";
import type { ScenarioComparisonOptions } from "@/lib/presentations/pages/scenario-comparison/types";

export const dynamic = "force-dynamic";
// Projects and Monte-Carlos up to four plans behind the commentary — same
// compute class as the sibling retirement-comparison route, where 60s starved
// on prod.
export const maxDuration = 300;

const Body = z.object({
  // Capped at three to match the page's own options schema: a fourth column
  // does not fit the sheet and would blow the Monte Carlo fan-out budget.
  scenarioIds: z.array(z.string().min(1)).min(1).max(3),
  tone: z.enum(["concise", "detailed", "plain"]),
  customInstructions: z.string().max(2000).default(""),
  maxSpend: z
    .object({
      show: z.boolean(),
      targetConfidence: z.number().min(0.5).max(0.99),
    })
    .default({ show: true, targetConfidence: 0.85 }),
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

    // The AI path reads the matrix and the bands, never the chart, so building
    // it would be wasted work. `showTradeoffBands` is on by definition — the
    // dialog only offers this call when the bands are what it is writing.
    const options: ScenarioComparisonOptions = {
      scenarioIds: body.scenarioIds,
      maxSpend: body.maxSpend,
      showChart: false,
      showTradeoffBands: true,
      // Nothing stored: an explicit request regenerates every chosen column.
      ai: { tone: body.tone, customInstructions: body.customInstructions, byScenario: {} },
    };

    const inputs = await prepareScenarioComparisonAiInputs(id, access.firmId, options);
    if (!inputs) {
      return NextResponse.json(
        { error: "None of the chosen scenarios could be compared against Base Case." },
        { status: 422 },
      );
    }

    const { byScenario, cached } = await generateScenarioComparisonAi({
      ...inputs,
      clientId: id,
      tone: body.tone,
      customInstructions: body.customInstructions,
      stored: {},
      force: body.force,
    });

    await recordAudit({
      // Reuse the existing AI-commentary action; the closed AuditAction union
      // has no scenario-comparison-specific value and we don't edit helpers
      // here. `surface` in metadata distinguishes it from its siblings.
      action: "comparison.ai_generate",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        surface: "presentations.scenario_comparison",
        scenarioIds: body.scenarioIds,
        tone: body.tone,
        force: body.force,
        cached,
      }),
    });

    return NextResponse.json({ byScenario, cached });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(err) },
        { status: 400 },
      );
    }
    // Same mapping the export route applies to the shared bundle loader's two
    // sentinel errors. ProjectionInputError's message is already scrubbed by
    // loadPageScenarioBundles — the raw one embeds client / CRM-household UUIDs.
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ProjectionInputError) {
      return NextResponse.json(
        { error: "Client data is incomplete or invalid for this projection." },
        { status: 422 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST presentations/scenario-comparison-ai", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
