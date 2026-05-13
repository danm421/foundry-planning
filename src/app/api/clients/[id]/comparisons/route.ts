import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, clientComparisons, comparisonTemplates } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { ComparisonLayoutV5Schema } from "@/lib/comparison/layout-schema";
import {
  findPreset,
  resolveSlots,
  cloneComparisonTemplate,
} from "@/lib/comparison/templates";

export const dynamic = "force-dynamic";

async function requireClientInFirm(id: string, firmId: string) {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  return client ?? null;
}

const CreateBody = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("blank"),
    name: z.string().min(1).max(200),
  }),
  z.object({
    source: z.literal("preset"),
    presetKey: z.string(),
    name: z.string().min(1).max(200),
    slotMappings: z.record(z.string(), z.string()),
  }),
  z.object({
    source: z.literal("template"),
    templateId: z.string().uuid(),
    name: z.string().min(1).max(200),
    slotMappings: z.record(z.string(), z.string()),
  }),
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db
      .select({
        id: clientComparisons.id,
        name: clientComparisons.name,
        sourceTemplateId: clientComparisons.sourceTemplateId,
        createdAt: clientComparisons.createdAt,
        updatedAt: clientComparisons.updatedAt,
      })
      .from(clientComparisons)
      .where(and(eq(clientComparisons.clientId, id), eq(clientComparisons.firmId, firmId)))
      .orderBy(asc(clientComparisons.name));

    return NextResponse.json({ comparisons: rows });
  } catch (err) {
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("GET /api/clients/[id]/comparisons error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = CreateBody.parse(await req.json());

    let layout;
    let sourceTemplateId: string | null = null;

    if (body.source === "blank") {
      layout = {
        version: 5 as const,
        title: body.name,
        groups: [],
      };
    } else if (body.source === "preset") {
      const preset = findPreset(body.presetKey);
      if (!preset) return NextResponse.json({ error: "Unknown preset" }, { status: 400 });
      const cloned = cloneComparisonTemplate(preset.layout);
      layout = resolveSlots(cloned, body.slotMappings as Record<string, string>);
    } else {
      const [tmpl] = await db
        .select()
        .from(comparisonTemplates)
        .where(and(eq(comparisonTemplates.id, body.templateId), eq(comparisonTemplates.firmId, firmId)));
      if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      const cloned = cloneComparisonTemplate(tmpl.layout);
      layout = resolveSlots(cloned, body.slotMappings as Record<string, string>);
      sourceTemplateId = tmpl.id;
    }

    ComparisonLayoutV5Schema.parse(layout);

    const [row] = await db
      .insert(clientComparisons)
      .values({ firmId, clientId: id, name: body.name, layout, sourceTemplateId })
      .returning();

    await recordAudit({
      action: "client_comparison.create",
      resourceType: "client_comparison",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: { source: body.source, name: body.name },
    });

    return NextResponse.json({ comparison: row }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    if (err instanceof Error && /missing mapping for slot/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("POST /api/clients/[id]/comparisons error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
