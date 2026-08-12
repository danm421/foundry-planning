import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import { listStoryChapters, resolveChapterText } from "@/lib/presentations/story/repo";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
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
    const rows = await listStoryChapters(id, scenarioId);
    const byId = new Map(rows.map((r) => [r.chapterId, r]));

    // Every chapter appears, generated or not — the panel needs a row to show
    // "not generated yet" against, not a gap.
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
      };
    });

    return NextResponse.json({ scenarioId, chapters });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/plan-story error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
