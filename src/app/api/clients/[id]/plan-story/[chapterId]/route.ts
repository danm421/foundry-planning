import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { parseBody } from "@/lib/schemas/common";
import { planStoryChapterPatchSchema } from "@/lib/schemas/plan-story";
import {
  updateChapterText,
  markChapterReviewed,
  loadStoryChapter,
  hasNewerGeneration,
} from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { CHAPTER_IDS, type ChapterId } from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";

function isChapterId(v: unknown): v is ChapterId {
  return typeof v === "string" && (CHAPTER_IDS as readonly string[]).includes(v);
}

/**
 * The advisor's three write actions on one chapter: replace its words, say they
 * stand behind them, and let a rewrite their own version was standing in front
 * of through.
 *
 * Both WRITERS — `updateChapterText` and `markChapterReviewed` — are upserts, so
 * each either stores the write or throws. Neither has a zero-row outcome to
 * check for, and neither has a chapter that "has no row yet" to 404 on: the
 * panel offers every chapter whether one was ever generated or not, so writing
 * one from scratch is a first-class path rather than an edge case.
 *
 * There is also exactly ONE read, `loadStoryChapter`, and only on the accept
 * path. It is NOT an authorization check — it is scoped on the same
 * already-authorized clientId as everything else here, and its job is to
 * confirm the row really is shadowing a newer generation before the accept
 * throws the advisor's version away. So it is this handler's only zero-row
 * branch, and it answers 409 (the row moved under a click that was correct when
 * it was made) rather than 404 (the chapter is real either way). The edit and
 * review paths stay read-free, and a test pins them that way.
 *
 * That leaves `requireClientEditAccess` the only thing standing between a
 * caller and another client's row, which is why it runs ahead of all four calls
 * — the edit's upsert, the accept's read and its upsert, and the review's
 * upsert.
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
    const { editedText, reviewed, documentRole, acceptGenerated } = parsed.data;
    // Reported rather than answered with a cheerful `{ ok: true }`: a panel bug
    // that sends no field at all would otherwise look exactly like a saved edit.
    if (editedText === undefined && reviewed !== true && acceptGenerated !== true) {
      return NextResponse.json(
        { error: "Nothing to update — send editedText, reviewed or acceptGenerated" },
        { status: 400 },
      );
    }
    /**
     * ⚠️ Two contradictory instructions in one body: "store these words" and
     * "throw my words away". Resolving them silently resolves them LOSSILY —
     * the accept writes an empty string over whatever the same request just
     * saved — and this is the one path in the feature that destroys advisor
     * writing, so it may not run as a side effect of a request that also meant
     * to keep some. A caller sending both is a caller bug, and a 400 says so.
     */
    if (editedText !== undefined && acceptGenerated === true) {
      return NextResponse.json(
        { error: "Send either editedText or acceptGenerated, not both" },
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

    /**
     * The advisor has read the rewrite their own words were standing in front
     * of, and chosen it.
     *
     * `editedText: ""` rather than a delete: the empty string is ALREADY the
     * documented "drop my version and let the model's words render again"
     * (`schemas/plan-story.ts`), so this reuses a shipped path instead of
     * adding a second way to say the same thing — and `generatedText` is
     * untouched either way, so nothing about it is irreversible except the
     * advisor's own sentences, which is what the click is for.
     */
    if (acceptGenerated === true) {
      /**
       * ⚠️⚠️ WHY THE READ ABOVE EARNS ITS PLACE ON THIS PATH ALONE.
       *
       * The banner this click comes from was rendered off a chapter list that
       * can be minutes old: an advisor with the report open in two tabs can
       * save a fresh edit in one and press this in the other, and an unchecked
       * accept would then discard writing nothing had shadowed and revert the
       * chapter to OLDER model prose.
       *
       * The click stays explicit and audited either way, so this is not what
       * keeps Decision 1 true. It is what keeps the button's own sentence true
       * — "the assistant rewrote this chapter after you edited it" — and a
       * control that lies about what it is about to do is the defect this whole
       * task exists to fix.
       *
       * 409 rather than 400: the request was well formed and was right when it
       * was made. The row moved underneath it.
       */
      const row = await loadStoryChapter({ clientId: id, scenarioId, documentRole, chapterId });
      if (row == null || !hasNewerGeneration(row)) {
        return NextResponse.json(
          { error: "This chapter has no newer version to switch to — reload and look again." },
          { status: 409 },
        );
      }
      await updateChapterText({ clientId: id, scenarioId, documentRole, chapterId, editedText: "" });
      await recordAudit({
        action: "plan_story.generated_accepted",
        resourceType: "plan_story_chapter",
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
