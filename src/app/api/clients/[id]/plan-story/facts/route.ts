// The figures a chapter was allowed to use, disclosed to the review panel —
// so an advisor approving a chapter's prose can also see what it could have
// quoted. The pack already exists on every `StoryContext` (`facts.ts`); this
// route is what makes the panel able to ask for it.
//
// ⚠️⚠️ ITS OWN ENDPOINT, deliberately, and not a field on the chapter list —
// the same reason the staleness check (`../stale/route.ts`) is separate.
// Answering it means loading a whole story context through `loadStoryRun` —
// MEASURED 2026-08-14 at 23.2s cold, 4.0s warm — and the chapter list is
// reread after EVERY save. A `facts` field there would put four seconds
// behind every blur.
//
// The panel calls this once, on mount, beside the staleness GET — a SECOND,
// independent `loadStoryRun`. The two requests run concurrently, so the
// advisor waits once. What the SERVER pays depends on whether anything has
// been generated yet: on a freshly opened report the staleness route
// short-circuits before its own `loadStoryRun` (`../stale/route.ts` — nothing
// stored means nothing can be stale, "the common case for a report an
// advisor has only just opened"), so this route's run is the only one that
// mount pays for. Once something HAS been generated, both routes run it, and
// the server pays the projection cost twice.
// Folding this into the staleness response was considered and rejected:
// that route also re-runs on every STYLE change (`Ruling T9-1`), and facts do
// not move when a tone does — a fold would put a twenty-second load behind a
// tone dropdown for a question the tone cannot change the answer to.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import { isDocumentRole, type DocumentRole } from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { loadStoryRun } from "@/lib/presentations/story/run-context";
import { CHAPTER_IDS, factsForChapter, type ChapterId } from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";
// Same cost, same reason as the staleness route: `loadStoryRun` runs two
// projections, a Monte Carlo read and a balance sheet, and on a proposal two
// solves. The measured cold number above is well inside this ceiling.
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // The org check is the gate; the user id is needed only because
    // `loadStoryRun` requires one — see the note on `advisorUserId` in
    // `run-context.ts`. Facts come from `ctx.facts`, built from plan
    // projections, and `factsForChapter` filters by chapter id alone: neither
    // reads voice, so any identity this call supplies produces the same pack.
    const { userId } = await requireOrgAndUser();
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    // Same rule as the chapter list and the staleness route: ABSENT is a
    // pre-0240 caller reading the column's own default; PRESENT but
    // unrecognised is a caller bug, and guessing which preset they meant
    // answers about the wrong rows.
    const roleParam = url.searchParams.get("documentRole");
    if (roleParam !== null && !isDocumentRole(roleParam)) {
      return NextResponse.json({ error: "Unknown documentRole" }, { status: 400 });
    }
    const documentRole: DocumentRole = roleParam ?? "standalone";

    // Resolved, not taken on trust — this route goes on to LOAD the scenario,
    // and `loadStoryContext` degrades a snapshot ref to a proposal with no
    // strategies, which is not a context any chapter was actually written
    // from.
    const scope = await resolveStoryScenarioId(id, url.searchParams.get("scenarioId"));
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const { scenarioId } = scope;

    const { ctx } = await loadStoryRun({
      clientId: id,
      firmId: access.firmId,
      advisorUserId: userId,
      scenarioId,
      documentRole,
    });

    // Every chapter, even one with nothing written yet — the panel shows the
    // disclosure beside every row, generated or not, so a chapter with no
    // prose still needs an answer rather than a gap.
    const facts = Object.fromEntries(
      CHAPTER_IDS.map((chapterId) => [
        chapterId,
        // Only what the advisor is meant to see: the model's `raw` number and
        // stable `id` are internal, and sending them would be the first step
        // toward a chapter that quotes a figure the gate never checked.
        factsForChapter(ctx.facts, chapterId).map((f) => ({ label: f.label, display: f.display })),
      ]),
    ) as Record<ChapterId, Array<{ label: string; display: string }>>;

    return NextResponse.json({ facts });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/plan-story/facts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
