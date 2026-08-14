// Generation runs HERE, in the review panel's flow — not at export. An advisor
// waits once, ahead of the meeting; the PDF export then makes no LLM calls at
// all. maxDuration matches the presentation runs route for the same reason.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkPlanStoryRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { parseBody } from "@/lib/schemas/common";
import { planStoryGenerateSchema } from "@/lib/schemas/plan-story";
import { loadStoryRun } from "@/lib/presentations/story/run-context";
import { generateChapter } from "@/lib/presentations/story/generate";
import { upsertGeneratedChapter } from "@/lib/presentations/story/repo";
import { resolveStoryScenarioId } from "@/lib/presentations/story/scenario-scope";
import { CHAPTERS, storyCandidates } from "@/lib/presentations/story/chapters/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Refused twice — cheaply from the ref, and again once the facts are in — so
 *  the advisor reads one sentence either way. */
const NOTHING_TO_SAY = "That chapter has nothing to say for this plan.";

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
    // One value, read once: it changes the PROSE (via the prompt) and, since
    // 0240, which row that prose is stored on. Two reads is how those two
    // could ever disagree.
    const { documentRole } = parsed.data;
    /** One chapter, from the panel's Regenerate. Absent means the whole story. */
    const requested = parsed.data.chapterId;

    // A chapter this story could never narrate — a recommendation on a base-only
    // report — is refused here, before anything is spent. `storyCandidates` is
    // derived from the ref alone, so asking costs nothing, while the refusal
    // below it costs a full context. A pre-check, not THE check: the full answer
    // also reads `available` and `hasSomethingToPropose`, which need the facts.
    if (requested && !storyCandidates(scenarioId).includes(requested)) {
      return NextResponse.json({ error: NOTHING_TO_SAY }, { status: 400 });
    }

    /**
     * The per-firm ceiling on model spend (budgets and their reasoning live with
     * the limiter, in `rate-limit.ts`).
     *
     * Checked BEFORE the story context loads: that load runs two projections, a
     * Monte Carlo read and (on a proposal) two solves — 23.2s cold — and a
     * request that is going to be refused must not pay for them. After the
     * access gates, though, so a caller who may not touch this client cannot
     * spend the budget of the firm that can.
     *
     * ⚠️ The limiter FAILS CLOSED (the standing rule for this repo): with no
     * Upstash configuration the route refuses rather than running uncapped. A
     * misconfigured environment must not be the cheapest way to spend model
     * budget.
     */
    const rl = await checkPlanStoryRateLimit(firmId, requested ? "chapter" : "run");
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "This firm has generated a lot of story chapters just now. Try again in a moment.",
      );
    }

    // The load, and the `candidates` list it is scoped to, live in
    // `run-context.ts` — the staleness route has to rebuild the IDENTICAL
    // context to compare a stored hash against, and two copies of these lines
    // that drift by so much as a scenario label would report every chapter on
    // the report out of date. Read the invariant on `StoryRun.candidates`
    // before changing either.
    //
    // ⚠️ NOT narrowed to `requested`, deliberately, even though a one-chapter
    // rewrite then pays for the whole story's facts and both solves. The
    // staleness route always loads the FULL candidate set, and the fact pack it
    // builds is not simply per-chapter: `build-facts.ts` seeds its
    // quoted-figure dedup from every fact built so far, so a narrower load can
    // ADMIT a figure the full load suppresses — a different prompt, a different
    // stored hash, and a chapter that reads permanently out of date with
    // nothing able to clear it. Scoping this is a real saving and its own
    // change; it is not free.
    const { ctx, candidates, voiceSamples } = await loadStoryRun({
      clientId: id,
      firmId,
      scenarioId,
      documentRole,
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

    // A named chapter is a FILTER over that list, never a way around it — so it
    // is written as one, and cannot be edited into a superset of `wanted` by
    // accident. Asking for a chapter this story cannot supply is a refusal, not
    // a model call: that is the hole Plan 1 closed at this exact line — a
    // chapter with nothing supplied to name is the one state `generate.ts`'s
    // substance floor cannot judge — and a new parameter is the obvious way to
    // re-open it.
    const chapters = requested ? wanted.filter((c) => c === requested) : wanted;
    if (requested && chapters.length === 0) {
      return NextResponse.json({ error: NOTHING_TO_SAY }, { status: 400 });
    }

    // Chapters are independent — generate them concurrently. Each one already
    // swallows its own failure and falls back, so this never rejects.
    const generated = await Promise.all(
      chapters.map((chapterId) =>
        generateChapter({
          clientId: id,
          chapterId,
          ctx,
          // From the run, not a literal: they are an input to the stored
          // `sourceHash`, and the staleness route rebuilds that hash from the
          // same object (`run-context.ts`).
          voiceSamples,
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
        // Which purchase this row records. A whole run and a one-chapter rewrite
        // differ by a factor of fourteen in spend, and a count alone cannot tell
        // "the story was regenerated" from "one paragraph was".
        chapterId: requested ?? null,
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
