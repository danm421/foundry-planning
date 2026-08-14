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
    // One value, read once: it changes the PROSE (via the prompt) and, since
    // 0240, which row that prose is stored on. Two reads is how those two
    // could ever disagree.
    const { documentRole } = parsed.data;

    /**
     * The chapters this run COULD narrate, so the loader can skip the solves
     * behind facts nothing will read. On a base-only run that is both max-spend
     * solves, since the chapter reading them requires a proposal.
     *
     * ⚠️ It is NOT `wanted` below, and it cannot be: that list reads
     * `available` and `hasSomethingToPropose`, both derived from `ctx`, which is
     * what this call RETURNS. So the list going in is derived from the REF
     * alone, which is everything known before the facts exist.
     *
     * Deliberately looser as a result — a proposal carrying no changes still
     * solves its max spend. That is the correct direction to be wrong in: the
     * list must be a SUPERSET of what gets narrated, or a chapter is written
     * from a pack missing its own facts and prints an honest empty state on a
     * document handed to a client.
     */
    const candidates = CHAPTER_IDS.filter(
      (c) => proposedRef != null || !CHAPTERS[c].requiresProposal,
    );

    const ctx = await loadStoryContext({
      clientId: id,
      firmId,
      proposedRef,
      scenarioLabel: proposedRef ? "the proposed plan" : "Base Case",
      documentRole,
      chapters: candidates,
    });

    /**
     * A chapter that requires a proposal needs something IN the proposal.
     *
     * `hasProposal` is derived from the REF alone (`load-context.ts`), so a
     * scenario an advisor created but has not edited yet reads as a proposal
     * carrying no changes. The recommendation chapter's only honest content is
     * then the one sentence its deterministic narrator already writes, which the
     * export renders for any chapter with no stored row — so generating it buys
     * nothing and costs a model call.
     *
     * It also costs safety. `generate.ts`'s substance floor is exactly as
     * demanding as the narrator, and the narrator for THIS state names nothing
     * we supplied — so it is the one chapter state where a refusal or an echo of
     * an injected instruction clears all four gates, publishes, and is cached for
     * 30 days. Not generating it is what makes that state unreachable.
     */
    const hasSomethingToPropose = ctx.hasProposal && ctx.strategies.length > 0;
    //
    // Narrowed from `candidates` rather than from `CHAPTER_IDS`, so the
    // superset invariant above holds BY CONSTRUCTION instead of by two filters
    // that happen to agree.
    //
    // …and `available` on top of that: a coverage chapter with nothing behind it
    // — no policies on file, nobody reaching 65 inside the horizon — has only
    // its narrator's empty state to say, and a model call cannot improve on a
    // sentence whose whole job is to admit we have no data. The chapter still
    // PRINTS: `printedChapters` reserves its sheet from the options alone and
    // deliberately cannot see this predicate (see `registry.ts`), so hiding it
    // here costs the spend and nothing else.
    //
    // Evaluated on the FULL pack rather than the chapter-scoped one. The scoping
    // in `factsForChapter` would change no answer today — every fact these
    // predicates look for is scoped to the chapter asking — but the predicate is
    // a question about the HOUSEHOLD, and `registry.test.ts` pins it that way.
    const wanted = candidates.filter((c) => {
      const def = CHAPTERS[c];
      if (def.requiresProposal && !hasSomethingToPropose) return false;
      return def.available?.(ctx) ?? true;
    });

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

    // Audited BEFORE the writes, deliberately. This row records the RUN — the
    // model calls happened, they were paid for, and someone regenerated this
    // client's story — not the persistence that follows. `Promise.all` rejects on
    // the first failing upsert while every chapter that already resolved stays
    // committed, so auditing after it means a 500 that silently commits half a
    // run and leaves no trace of the spend at all.
    //
    // Chosen over a `try/finally` with a partial flag: the flag buys a more
    // precise row at the cost of a second control flow around the writes and an
    // audit call inside `finally` that can replace the write's own error on the
    // way out. Everything this row asserts is already true at this line.
    await recordAudit({
      action: "plan_story.generated",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        scenarioId,
        documentRole,
        chapters: generated.length,
        suppressed: generated.filter((g) => g.aiSuppressed).map((g) => g.chapterId),
      }),
    });

    await Promise.all(
      generated.map((chapter) => upsertGeneratedChapter({ clientId: id, scenarioId, documentRole, chapter })),
    );

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
