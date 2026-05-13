// src/app/api/clients/[id]/comparison/describe-changes/route.ts
//
// POST: generate a one-sentence Markdown description of a scenario change unit.
// Mirrors ai-analysis/route.ts: Zod-validated body, firm scoping, Upstash cache
// (keyed by SHA-256 of assembled prompts), rate limiting, audit recording.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  getCachedAnalysis,
  setCachedAnalysis,
  hashAiRequest,
} from "@/lib/comparison/ai-cache";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { describeChangeUnit, type ChangeUnit } from "@/lib/comparison/scenario-change-describe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ChangeSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  opType: z.enum(["add", "edit", "remove"]),
  targetKind: z.string(),
  targetId: z.string(),
  payload: z.unknown().nullable(),
  toggleGroupId: z.string().nullable(),
  orderIndex: z.number(),
  enabled: z.boolean(),
});

const UnitSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("single"),
    change: ChangeSchema,
  }),
  z.object({
    kind: z.literal("group"),
    groupName: z.string(),
    changes: z.array(ChangeSchema),
  }),
]);

const BodySchema = z.object({
  scenarioId: z.string().uuid(),
  unit: UnitSchema,
  targetNames: z.record(z.string(), z.string()).default({}),
  force: z.boolean().default(false),
});

const SYSTEM_PROMPT =
  "You are a financial-planning analyst. Given a structured scenario change (a single edit/add/remove or a named group of changes) plus display names for the entities referenced, write ONE sentence (≤ 35 words) describing what this change does relative to a base plan. Be precise about numbers and dates. Do NOT speculate about downstream effects.";

function buildUserPrompt(unit: ChangeUnit, targetNames: Record<string, string>): string {
  const deterministic = describeChangeUnit(unit, targetNames);
  return [
    "Change payload:",
    JSON.stringify(unit, null, 2),
    "",
    "Target name lookup:",
    JSON.stringify(targetNames, null, 2),
    "",
    "Deterministic baseline (you can improve fluency, but match the facts):",
    deterministic,
  ].join("\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    const rl = await checkExtractRateLimit(firmId);
    if (!rl.allowed) return rateLimitErrorResponse(rl, "AI describe-changes rate limit exceeded");

    // `body.unit`'s schema-derived `targetKind`/`opType` are `string`/string-union
    // unions; `ChangeUnit` carries the engine's narrower literal unions. The
    // describer only reads these as strings, so the cast is sound.
    const userPrompt = buildUserPrompt(body.unit as unknown as ChangeUnit, body.targetNames);
    const hash = hashAiRequest({ system: SYSTEM_PROMPT, user: userPrompt });

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

    // Pin gpt-5.4 explicitly for predictability across environments,
    // matching the ai-analysis route's approach.
    const markdown = (await callAIExtraction(SYSTEM_PROMPT, userPrompt, "gpt-5.4")).trim();
    const generatedAt = new Date().toISOString();

    await setCachedAnalysis(id, hash, { markdown, generatedAt });

    await recordAudit({
      action: "comparison.ai_describe_changes",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: {
        scenarioId: body.scenarioId,
        unitKind: body.unit.kind,
      },
    });

    return NextResponse.json({ markdown, generatedAt, cached: false, hash });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST comparison/describe-changes", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
