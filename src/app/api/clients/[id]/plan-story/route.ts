import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import {
  listStoryChapters,
  resolveChapterText,
  hasNewerGeneration,
  isDocumentRole,
  type DocumentRole,
} from "@/lib/presentations/story/repo";
import { CHAPTERS, storyCandidates } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Not validated against `scenarios`: this reads, and an id that owns no
    // rows simply lists every chapter as never generated. The write paths pay
    // for that lookup because they can CREATE a row keyed on it.
    const scenarioId = new URL(request.url).searchParams.get("scenarioId") ?? "base";
    /**
     * ABSENT means "standalone" — an old client, reading exactly the rows the
     * column's own default says are its. PRESENT but unrecognised is a caller
     * bug and a 400: guessing there is how a brief's rows get read under the
     * full story's heading, which is the failure `document_role` exists to stop.
     */
    const roleParam = new URL(request.url).searchParams.get("documentRole");
    if (roleParam !== null && !isDocumentRole(roleParam)) {
      return NextResponse.json({ error: "Unknown documentRole" }, { status: 400 });
    }
    const documentRole: DocumentRole = roleParam ?? "standalone";
    const rows = await listStoryChapters(id, scenarioId, documentRole);
    const byId = new Map(rows.map((r) => [r.chapterId, r]));
    // Which rows a generation could write at all, so the panel can leave the
    // Regenerate button off the ones it could only refuse. Asked HERE rather
    // than re-derived in the panel: "does this story have a proposal" would
    // otherwise be spelled a third time, in a client component, where it goes
    // stale silently the day the derivation grows a second condition.
    const candidates = new Set(storyCandidates(scenarioId));

    // Every chapter appears, generated or not — the panel needs a row to show
    // "not generated yet" against, not a gap.
    //
    // `CHAPTER_IDS`, the whole arc, in DOCUMENT ORDER — the panel lists the
    // chapters in the order the report prints them. It was the narrated subset
    // while the arc was landing a chapter at a time, so that a slot with no
    // narrator could not list as a row an advisor presses Generate on; every
    // slot has one now.
    const chapters = CHAPTER_IDS.map((chapterId) => {
      const row = byId.get(chapterId);
      const def = CHAPTERS[chapterId];
      return {
        chapterId,
        title: def.title,
        text: row ? resolveChapterText(row, "") : "",
        generated: row?.generatedText != null,
        edited: (row?.editedText ?? "").trim().length > 0,
        aiSuppressed: row?.aiSuppressed ?? false,
        // The other half of `aiSuppressed`. An outage sets no gate findings, so
        // a chapter suppressed because the assistant was down is stored exactly
        // like one the gates rejected; without this the panel can only offer a
        // blank reason.
        error: row?.error ?? null,
        reviewed: row?.reviewedAt != null,
        /**
         * The model's rewrite, WHEN it is newer than the advisor's edit and so
         * is stored without being what prints — null otherwise.
         *
         * Sent as the prose rather than as a flag because the panel shows it:
         * the advisor is being asked whether to discard their own words for
         * these, and a click that says "use the new version" without showing
         * the new version is not a click they can make. `text` above is
         * unchanged and still the advisor's, which is the whole point — nothing
         * here overwrites their words.
         */
        newerGeneratedText: row && hasNewerGeneration(row) ? row.generatedText : null,
        /**
         * Could a generation write this chapter for this story at all? False for
         * the five chapters that need a proposal when the report is base-only.
         *
         * ⚠️ A SUPERSET — the ref-level half of the answer only. A coverage
         * chapter with no policies behind it is `true` here and still refused
         * once the facts are in, and the panel still reports THAT refusal as a
         * message. So this is what hides a button, never what authorizes a run.
         */
        candidate: candidates.has(chapterId),
      };
    });

    return NextResponse.json({ scenarioId, documentRole, chapters });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/plan-story error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
