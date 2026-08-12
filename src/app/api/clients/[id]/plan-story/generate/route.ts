// Generation runs HERE, in the review panel's flow — not at export. An advisor
// waits once, ahead of the meeting; the PDF export then makes no LLM calls at
// all. maxDuration matches the presentation runs route for the same reason.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { parseBody } from "@/lib/schemas/common";
import { planStoryGenerateSchema } from "@/lib/schemas/plan-story";
import { loadStoryContext } from "@/lib/presentations/story/load-context";
import { generateChapter } from "@/lib/presentations/story/generate";
import { upsertGeneratedChapter } from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(planStoryGenerateSchema, request);
    if (!parsed.ok) return parsed.response;

    const scope = await resolveStoryScenarioId(id, parsed.data.scenarioId);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const { scenarioId } = scope;
    const proposedRef = scenarioId === "base" ? null : scenarioId;

    const ctx = await loadStoryContext({
      clientId: id,
      firmId,
      proposedRef,
      scenarioLabel: proposedRef ? "the proposed plan" : "Base Case",
      documentRole: parsed.data.documentRole ?? "standalone",
    });

    const wanted = CHAPTER_IDS.filter((c) => ctx.hasProposal || !CHAPTERS[c].requiresProposal);

    // Chapters are independent — generate them concurrently. Each one already
    // swallows its own failure and falls back, so this never rejects.
    const generated = await Promise.all(
      wanted.map((chapterId) =>
        generateChapter({
          clientId: id,
          chapterId,
          ctx,
          voiceSamples: [],
          force: parsed.data.force ?? false,
        }),
      ),
    );

    await Promise.all(
      generated.map((chapter) => upsertGeneratedChapter({ clientId: id, scenarioId, chapter })),
    );

    await recordAudit({
      action: "plan_story.generated",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        scenarioId,
        chapters: generated.length,
        suppressed: generated.filter((g) => g.aiSuppressed).map((g) => g.chapterId),
      }),
    });

    return NextResponse.json({
      chapters: generated.map((g) => ({
        chapterId: g.chapterId,
        aiSuppressed: g.aiSuppressed,
        // Why, when the model never produced a draft at all. An outage files no
        // gate findings, so `aiSuppressed` alone leaves the advisor who just
        // pressed Generate with a flag and no reason.
        error: g.error,
        cached: g.cached,
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/plan-story/generate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
