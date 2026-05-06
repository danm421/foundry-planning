// src/app/api/clients/[id]/reports/[reportId]/ai-analysis/route.ts
//
// POST: generate Markdown commentary for an `aiAnalysis` widget on a
// report. Mirrors the document-extraction call: same Azure wrapper,
// same firm-keyed extract rate limit, same fail-closed posture. The
// route runs the projection once, fans out to the scope registry to
// produce token-capped per-scope summaries, and hands the assembled
// system + user prompts to `callAIExtraction(..., "full")` so advisors
// get the higher-quality model on this user-facing surface.
//
// SOC-2: every successful generation appends a `report.ai_generate`
// audit row so the firm has a record of which widget was generated,
// with what scopes/tone/length, against which report.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, reports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { runProjection } from "@/engine/projection";
import {
  loadDataForScopes,
} from "@/lib/reports/data-loader";
import "@/lib/reports/scopes";
import { buildAiPrompt } from "@/lib/reports/ai-prompt";
import { callAIExtraction } from "@/lib/extraction/azure-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  widgetId: z.string(),
  scopes: z
    .array(z.enum(["cashflow", "balance", "monteCarlo", "tax", "estate"]))
    .min(1),
  tone: z.enum(["concise", "detailed", "plain"]),
  length: z.enum(["short", "medium", "long"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, reportId } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [report] = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.clientId, id),
          eq(reports.firmId, firmId),
        ),
      );
    if (!report) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = Body.parse(await request.json());

    // Fail-closed extract limiter (5/min/firm). Shares the budget with
    // document extraction on purpose — both paths hit Azure OpenAI and
    // an advisor running away with regenerations shouldn't drain the
    // import flow's headroom.
    const rl = await checkExtractRateLimit(firmId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", reason: rl.reason },
        { status: 429 },
      );
    }

    // Run the projection through the same internal API the export route
    // uses, so engine inputs are scoped and authenticated identically.
    const apiRes = await fetch(
      `${new URL(request.url).origin}/api/clients/${id}/projection-data`,
      { headers: { cookie: request.headers.get("cookie") ?? "" } },
    );
    if (!apiRes.ok) {
      return NextResponse.json(
        { error: "Failed to load projection data" },
        { status: 500 },
      );
    }
    const apiData = await apiRes.json();
    const projection = runProjection(apiData);

    const scopeData = await loadDataForScopes(new Set(body.scopes), {
      client: { id },
      projection,
    });
    const householdName =
      [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";

    const { system, user } = buildAiPrompt({
      scopes: body.scopes,
      tone: body.tone,
      length: body.length,
      scopeData: scopeData as Record<string, unknown>,
      householdName,
    });

    // "full" model — advisors get the better completion on this
    // user-visible commentary surface (extraction defaults to "mini").
    const markdown = await callAIExtraction(system, user, "full");

    await recordAudit({
      action: "report.ai_generate",
      resourceType: "report",
      resourceId: report.id,
      clientId: id,
      firmId,
      metadata: {
        widgetId: body.widgetId,
        scopes: body.scopes,
        tone: body.tone,
        length: body.length,
      },
    });

    return NextResponse.json({
      body: markdown.trim(),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST ai-analysis", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
