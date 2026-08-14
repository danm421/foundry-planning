// Which stored chapters were written from a plan that has since moved.
//
// ⚠️⚠️ ITS OWN ENDPOINT, deliberately, and not a field on the chapter list.
// Answering it means rebuilding the whole story context — MEASURED 2026-08-14 at
// 23.2s cold and 4.0s warm on a 21-account household — and the review panel
// reloads that list after EVERY save. A flag on the list would put four seconds
// behind every blur. The panel calls this once on mount, and again after a
// generation run, which is the only other moment the answer can change.
//
// The context is rebuilt through `loadStoryRun`, the same helper the generate
// route writes from. That is the whole correctness argument: a hash rebuilt from
// so much as a different scenario label matches nothing, and the panel would
// then flag every chapter of every report out of date — a badge that is always
// on is worse than no badge, because the advisor learns to ignore it.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import {
  listStoryChapters,
  isChapterStale,
  isDocumentRole,
  type DocumentRole,
} from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { loadStoryRun } from "@/lib/presentations/story/run-context";
import { chapterSourceHash } from "@/lib/presentations/story/chapters/prompts";
import { isChapterId } from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";
// Two projections, a Monte Carlo read and a balance sheet, and on a proposal two
// solves. The measured cold number above is well inside this; the platform
// default would be too, but the cost is the reason this route exists separately
// and saying so here keeps the two facts together.
export const maxDuration = 300;

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

    const url = new URL(request.url);
    // Same rule as the chapter list: ABSENT is a pre-0240 caller reading the
    // column's own default; PRESENT but unrecognised is a caller bug, and
    // guessing which preset they meant answers about the wrong rows.
    const roleParam = url.searchParams.get("documentRole");
    if (roleParam !== null && !isDocumentRole(roleParam)) {
      return NextResponse.json({ error: "Unknown documentRole" }, { status: 400 });
    }
    const documentRole: DocumentRole = roleParam ?? "standalone";

    // Resolved, not taken on trust — unlike the chapter list, which only reads
    // rows. This one goes on to LOAD a scenario, and `loadStoryContext` degrades
    // a snapshot ref to a proposal with no strategies, which would hash
    // differently from anything the generate route ever wrote.
    const scope = await resolveStoryScenarioId(id, url.searchParams.get("scenarioId"));
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const { scenarioId } = scope;

    const rows = await listStoryChapters(id, scenarioId, documentRole);
    // `flatMap` rather than `filter`: `chapter_id` is text in the database, and
    // the narrowing has to survive into the hash call below.
    const generated = rows.flatMap((r) =>
      r.sourceHash != null && isChapterId(r.chapterId)
        ? [{ chapterId: r.chapterId, sourceHash: r.sourceHash }]
        : [],
    );
    // Nothing generated, nothing that can be stale — and no reason to spend
    // twenty seconds proving it. This is the common case for a report an advisor
    // has only just opened, which is exactly when the panel asks.
    if (generated.length === 0) {
      return NextResponse.json({ scenarioId, documentRole, stale: [] });
    }

    const { ctx, candidates, voiceSamples } = await loadStoryRun({
      clientId: id,
      firmId: access.firmId,
      scenarioId,
      documentRole,
    });
    const inThisRun = new Set(candidates);

    const stale = generated
      // A stored row for a chapter this run would not load facts for. Rare but
      // reachable: the candidate list comes off the scenario ref, so a chapter
      // that GAINS `requiresProposal` in a later deploy leaves base-story rows
      // behind it. Skipped rather than hashed, because a chapter hashed without
      // its own facts matches nothing any run ever wrote — a stale badge nobody
      // can clear by regenerating.
      .filter((r) => inThisRun.has(r.chapterId))
      .filter((r) => isChapterStale(r, chapterSourceHash(r.chapterId, ctx, voiceSamples)))
      .map((r) => r.chapterId);

    return NextResponse.json({ scenarioId, documentRole, stale });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/plan-story/stale error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
