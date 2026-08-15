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
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import {
  listStoryChapters,
  isChapterStale,
  isDocumentRole,
  type DocumentRole,
} from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { loadStoryRun, loadAdvisorVoice } from "@/lib/presentations/story/run-context";
import type { StoryVoice } from "@/lib/presentations/story/voice/resolve";
import { chapterSourceHash } from "@/lib/presentations/story/chapters/prompts";
import { chapterStyleSchema } from "@/lib/presentations/pages/plan-story/options-schema";
import {
  isChapterId,
  resolveChapterStyles,
  type ChapterId,
  type ChapterStyle,
} from "@/lib/presentations/story/types";

export const dynamic = "force-dynamic";
// Two projections, a Monte Carlo read and a balance sheet, and on a proposal two
// solves. The measured cold number above is well inside this; the platform
// default would be too, but the cost is the reason this route exists separately
// and saying so here keeps the two facts together.
export const maxDuration = 300;

/**
 * The advisor's per-chapter tone and length, read off REPEATED FLAT parameters:
 * `?style=planInOnePage:direct:full&style=thingsToKnow:plain:short`.
 *
 * Null means one of them was unreadable, which is a 400 — the same rule
 * `documentRole` follows below, and for the same reason: a guessed style rebuilds
 * a different prompt from the one the run was written from, so every chapter
 * would read stale with nothing able to clear it.
 *
 * Flat rather than a JSON blob, matching every other query parameter this app
 * has: there is no JSON-encoded query parameter anywhere in `src/`, an
 * unguarded `JSON.parse` on query input throws into this route's `catch` and is
 * answered 500 where a caller error is a 400, and this form reads in a log.
 *
 * What a valid style IS comes from `chapterStyleSchema` — the same object the
 * saved deck and the generate body are validated against, so the three cannot
 * drift into accepting different tones. The explicit three-part check is what
 * keeps its per-field defaults from filling in a half-written parameter.
 */
function parseChapterStyles(values: string[]): Partial<Record<ChapterId, ChapterStyle>> | null {
  const styles: Partial<Record<ChapterId, ChapterStyle>> = {};
  for (const value of values) {
    const parts = value.split(":");
    if (parts.length !== 3) return null;
    const [chapterId, tone, length] = parts;
    if (!isChapterId(chapterId)) return null;
    const parsed = chapterStyleSchema.safeParse({ tone, length });
    if (!parsed.success) return null;
    styles[chapterId] = parsed.data;
  }
  return styles;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // The org check is the gate; the user id is needed as well because a
    // chapter that does not say who generated it is rebuilt in the CALLER's
    // voice — see the fallback below.
    const { userId } = await requireOrgAndUser();
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

    // Absent is the ordinary case — a panel where the advisor has changed no
    // tone — and means every chapter at the default. Resolved through the same
    // helper the generate route fills ITS gaps with, because a chapter neither
    // side was told about has to reach the same style on both.
    const requested = parseChapterStyles(url.searchParams.getAll("style"));
    if (requested === null) {
      return NextResponse.json({ error: "Unreadable style" }, { status: 400 });
    }
    const chapterStyles = resolveChapterStyles(requested);

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
        ? [
            {
              chapterId: r.chapterId,
              sourceHash: r.sourceHash,
              // Whose voice this chapter's stored hash was built from. Null on
              // every row written before the column existed.
              generatedByUserId: r.generatedByUserId,
            },
          ]
        : [],
    );
    // Nothing generated, nothing that can be stale — and no reason to spend
    // twenty seconds proving it. This is the common case for a report an advisor
    // has only just opened, which is exactly when the panel asks.
    if (generated.length === 0) {
      return NextResponse.json({ scenarioId, documentRole, stale: [] });
    }

    const { ctx, candidates, voice } = await loadStoryRun({
      clientId: id,
      firmId: access.firmId,
      advisorUserId: userId,
      scenarioId,
      documentRole,
    });
    const inThisRun = new Set(candidates);

    /**
     * ⚠️⚠️ A voice PER GENERATING ADVISOR, not one for the run.
     *
     * The badge answers "have the inputs THIS CHAPTER was written from
     * changed", and the voice is one of those inputs. Rebuilt in the caller's
     * voice it answers "would I get something different if I regenerated this"
     * instead — so a colleague opening a report a partner wrote in their own
     * personal voice reads an out-of-date badge on all fourteen chapters, and
     * the only thing that clears it is regenerating, which overwrites the
     * partner's prose to do it.
     *
     * Per ROW rather than per run because two advisors really can share a
     * report: one generates the story, another rewrites two chapters, and
     * those two are now in a different voice from the other twelve.
     *
     * ⚠️ One read per DISTINCT writer — in practice one, and usually zero
     * extra, since the run above already resolved the caller. Resolving inside
     * the filter below would be fourteen round trips to answer a question with
     * one or two answers.
     */
    const voices = new Map<string, StoryVoice>([[userId, voice]]);
    const writers = [
      ...new Set(
        generated.flatMap((r) =>
          r.generatedByUserId != null && !voices.has(r.generatedByUserId)
            ? [r.generatedByUserId]
            : [],
        ),
      ),
    ];
    const resolved = await Promise.all(writers.map((w) => loadAdvisorVoice(access.firmId, w)));
    writers.forEach((w, i) => voices.set(w, resolved[i]));

    const stale = generated
      // A stored row for a chapter this run would not load facts for. Rare but
      // reachable: the candidate list comes off the scenario ref, so a chapter
      // that GAINS `requiresProposal` in a later deploy leaves base-story rows
      // behind it. Skipped rather than hashed, because a chapter hashed without
      // its own facts matches nothing any run ever wrote — a stale badge nobody
      // can clear by regenerating.
      .filter((r) => inThisRun.has(r.chapterId))
      .filter((r) => {
        // A row that does not say who wrote it is compared against the
        // CALLER's voice, which is exactly what every row did before the
        // column existed — so no existing report's badges move on deploy, and
        // the row starts answering for itself the next time it is generated. A
        // firm default here would flip the answer for every existing
        // personal-voice row, and buy nothing.
        const writer = voices.get(r.generatedByUserId ?? userId) ?? voice;
        return isChapterStale(
          r,
          chapterSourceHash(r.chapterId, ctx, writer, chapterStyles[r.chapterId]),
        );
      })
      .map((r) => r.chapterId);

    return NextResponse.json({ scenarioId, documentRole, stale });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/plan-story/stale error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
