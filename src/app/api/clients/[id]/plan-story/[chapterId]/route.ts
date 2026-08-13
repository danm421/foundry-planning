import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { parseBody } from "@/lib/schemas/common";
import { planStoryChapterPatchSchema } from "@/lib/schemas/plan-story";
import { updateChapterText, markChapterReviewed } from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { CHAPTER_IDS, type ChapterId } from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";

function isChapterId(v: unknown): v is ChapterId {
  return typeof v === "string" && (CHAPTER_IDS as readonly string[]).includes(v);
}

/**
 * The advisor's two write actions on one chapter: replace its words, and say
 * they stand behind them.
 *
 * Both repo calls are upserts, so each one either stores the write or throws —
 * there is no zero-row outcome to check for, and no chapter that "has no row
 * yet" to 404 on. That makes `requireClientEditAccess` the sole barrier in
 * front of them, which is why it runs before either.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  try {
    const { id, chapterId } = await params;
    if (!isChapterId(chapterId)) {
      return NextResponse.json({ error: "Unknown chapter" }, { status: 400 });
    }
    const { orgId: callerOrg, userId } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(planStoryChapterPatchSchema, request);
    if (!parsed.ok) return parsed.response;
    // `undefined` = the field was absent. An empty string is a real instruction
    // — "drop my edit and let the model's words render again" — so the two
    // cannot be collapsed into a truthiness test.
    const { editedText, reviewed, documentRole } = parsed.data;
    // Reported rather than answered with a cheerful `{ ok: true }`: a panel bug
    // that sends neither field would otherwise look exactly like a saved edit.
    if (editedText === undefined && reviewed !== true) {
      return NextResponse.json(
        { error: "Nothing to update — send editedText or reviewed" },
        { status: 400 },
      );
    }

    const scope = await resolveStoryScenarioId(id, parsed.data.scenarioId);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const { scenarioId } = scope;

    if (editedText !== undefined) {
      await updateChapterText({ clientId: id, scenarioId, documentRole, chapterId, editedText });
      await recordAudit({
        action: "plan_story.chapter_edited",
        resourceType: "plan_story_chapter",
        // The chapter row has no id of its own worth quoting; the row is
        // identified by (clientId, scenarioId, documentRole, chapterId), and
        // the audit row already carries the first of those in its own column.
        resourceId: chapterId,
        clientId: id,
        firmId,
        metadata: crossFirmAuditMeta({ access }, callerOrg, { scenarioId, documentRole }),
      });
    }

    if (reviewed === true) {
      await markChapterReviewed({ clientId: id, scenarioId, documentRole, chapterId, userId });
      await recordAudit({
        action: "plan_story.chapter_reviewed",
        resourceType: "plan_story_chapter",
        resourceId: chapterId,
        clientId: id,
        firmId,
        metadata: crossFirmAuditMeta({ access }, callerOrg, { scenarioId, documentRole }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/plan-story/[chapterId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
