// src/app/api/clients/[id]/comparison/ai-analysis/route.ts
//
// POST: generate Markdown commentary for the comparison tool's text
// widget. Mirrors src/app/api/clients/[id]/reports/[reportId]/ai-analysis:
// same Azure wrapper, same firm-keyed extract rate limit, same fail-closed
// posture. Adds a Redis cache keyed by the SHA-256 of the assembled prompt
// strings so repeated Generate clicks on unchanged inputs are free.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { loadProjectionForRef, type LoadedProjection } from "@/lib/scenario/load-projection-for-ref";
import type { ScenarioRef } from "@/lib/scenario/loader";
import { ComparisonWidgetKindV4Schema, YearRangeSchema, AiToneSchema, AiLengthSchema } from "@/lib/comparison/layout-schema";
import { buildComparisonAiPrompt, type AiPlanYearly, type HouseholdContext } from "@/lib/comparison/ai-prompt";
import type { ClientInfo, PlanSettings } from "@/engine/types";
import { hashAiRequest, getCachedAnalysis, setCachedAnalysis } from "@/lib/comparison/ai-cache";
import { callAIExtraction } from "@/lib/extraction/azure-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ResolvedSourceSchema = z.object({
  cellId: z.string(),
  groupId: z.string(),
  groupTitle: z.string(),
  widgetKind: ComparisonWidgetKindV4Schema,
  planIds: z.array(z.string()),
  yearRange: YearRangeSchema.optional(),
});

const McAiPlanSummarySchema = z.object({
  planId: z.string(),
  label: z.string(),
  successRate: z.number(),
  ending: z.object({
    p5: z.number(),
    p20: z.number(),
    p50: z.number(),
    p80: z.number(),
    p95: z.number(),
    min: z.number(),
    max: z.number(),
    mean: z.number(),
  }),
  byYear: z
    .array(
      z.object({
        year: z.number(),
        age: z.number(),
        p5: z.number(),
        p50: z.number(),
        p95: z.number(),
      }),
    )
    .max(60),
});

const Body = z.object({
  resolvedSources: z.array(ResolvedSourceSchema).min(1).max(40),
  tone: AiToneSchema,
  length: AiLengthSchema,
  customInstructions: z.string().max(2000).default(""),
  mcByPlan: z.array(McAiPlanSummarySchema).max(20).nullish(),
  force: z.boolean().default(false),
});

function tokenToRef(tok: string): ScenarioRef {
  if (!tok || tok === "base") return { kind: "scenario", id: "base", toggleState: {} };
  if (tok.startsWith("snap:")) return { kind: "snapshot", id: tok.slice("snap:".length), side: "left" };
  return { kind: "scenario", id: tok, toggleState: {} };
}

function birthYear(dob: string | undefined): number | undefined {
  if (!dob) return undefined;
  const y = new Date(dob).getFullYear();
  return Number.isFinite(y) ? y : undefined;
}

function buildHouseholdContext(
  client: ClientInfo,
  settings: PlanSettings,
): HouseholdContext {
  const now = new Date().getFullYear();
  const clientBirth = birthYear(client.dateOfBirth);
  const spouseBirth = birthYear(client.spouseDob);

  return {
    clientFirstName: client.firstName,
    clientLastName: client.lastName,
    clientCurrentAge: clientBirth != null ? now - clientBirth : undefined,
    clientRetirementAge: client.retirementAge,
    clientRetirementYear:
      clientBirth != null ? clientBirth + client.retirementAge : undefined,
    planEndAge: client.planEndAge,
    spouse: client.spouseName
      ? {
          firstName: client.spouseName,
          currentAge: spouseBirth != null ? now - spouseBirth : undefined,
          retirementAge: client.spouseRetirementAge,
          retirementYear:
            spouseBirth != null && client.spouseRetirementAge != null
              ? spouseBirth + client.spouseRetirementAge
              : undefined,
        }
      : undefined,
    filingStatus: client.filingStatus,
    inflationRate: settings.inflationRate,
    residenceState: settings.residenceState ?? null,
    planStartYear: settings.planStartYear,
    planEndYear: settings.planEndYear,
  };
}

function summarizeLoadedAsAiPlan(token: string, loaded: LoadedProjection): AiPlanYearly {
  const years = loaded.result.years.map((y) => ({
    year: y.year,
    age: y.ages?.client ?? 0,
    income: y.income?.total ?? 0,
    expenses: y.expenses?.total ?? 0,
    taxes: y.taxResult?.flow?.totalTax ?? 0,
    endBalance: y.portfolioAssets?.total ?? 0,
  }));
  return { planId: token, label: loaded.scenarioName, years };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    const rl = await checkExtractRateLimit(firmId);
    if (!rl.allowed) return rateLimitErrorResponse(rl, "AI analysis rate limit exceeded");

    const planTokens = Array.from(
      new Set(body.resolvedSources.flatMap((s) => s.planIds)),
    );

    const loaded = await Promise.all(
      planTokens.map((tok) => loadProjectionForRef(id, firmId, tokenToRef(tok))),
    );
    const plans: AiPlanYearly[] = planTokens.map((tok, i) => summarizeLoadedAsAiPlan(tok, loaded[i]));

    // The household context (names, ages, retirement years, inflation, etc.)
    // is identical across plans for the same client. Pull it from the first
    // loaded projection's tree.
    const baseTree = loaded[0]?.tree;
    if (!baseTree) {
      return NextResponse.json({ error: "No projection data available" }, { status: 500 });
    }
    const household = buildHouseholdContext(baseTree.client, baseTree.planSettings);

    const { system, user } = buildComparisonAiPrompt({
      sources: body.resolvedSources,
      plans,
      tone: body.tone,
      length: body.length,
      customInstructions: body.customInstructions,
      household,
      mcByPlan: body.mcByPlan ?? null,
    });

    const hash = hashAiRequest({ system, user });

    if (!body.force) {
      const hit = await getCachedAnalysis(id, hash);
      if (hit) {
        return NextResponse.json({
          markdown: hit.markdown,
          generatedAt: hit.generatedAt,
          cached: true,
          hash,
        });
      }
    }

    // Pin gpt-5.4 explicitly rather than relying on the AZURE_ANALYSIS_MODEL
    // env override — keeps the comparison-tool output predictable across
    // environments.
    const markdown = (await callAIExtraction(system, user, "gpt-5.4")).trim();
    const generatedAt = new Date().toISOString();

    await setCachedAnalysis(id, hash, { markdown, generatedAt });

    await recordAudit({
      action: "comparison.ai_generate",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: {
        sources: body.resolvedSources.map((s) => ({ cellId: s.cellId, kind: s.widgetKind })),
        tone: body.tone,
        length: body.length,
        force: body.force,
      },
    });

    return NextResponse.json({ markdown, generatedAt, cached: false, hash });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST comparison/ai-analysis", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
