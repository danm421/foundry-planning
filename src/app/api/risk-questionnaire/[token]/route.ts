// src/app/api/risk-questionnaire/[token]/route.ts
//
// POST /api/risk-questionnaire/[token] -- public (no auth), token-scoped.
// The client (or spouse) completes the RTQ from an emailed link. This route
// authenticates by token alone and may write NOTHING except its own
// `risk_questionnaires` row and the profile recompute that row triggers. It
// never accepts a clientId from the body -- the client is whatever the
// token's row says it is.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { riskQuestionnaires } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  extractClientIp,
  checkIntakeSubmitRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { requireActiveSubscriptionForFirmNoSession, ForbiddenError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { RTQ_SUBMIT_SCHEMA } from "@/lib/risk/schema";
import { isCompleteRtq, scoreRtq } from "@/lib/risk/rtq";
import { applyRtqPatch } from "@/lib/risk/apply-rtq";
import { recomputeProfileTx } from "@/lib/risk/profile";
import { loadExistingScores } from "@/lib/risk/existing-scores";
import {
  loadQuestionnaireByToken,
  classifyToken,
  OPEN_RTQ_STATUSES,
} from "@/lib/risk/token-guard";

export const dynamic = "force-dynamic";

/**
 * Thrown when the guarded UPDATE below matches no row, i.e. a concurrent
 * request already claimed this questionnaire. Rolls the transaction back on
 * the way out and is converted to a 409 by the handler -- the same answer the
 * step-2 classification would have given had it run a moment later.
 */
class AlreadySubmittedError extends Error {}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Rate limiting (keyed on token:ip) -- reuses the intake submit bucket
  // (10/hr) on purpose; the key includes the token so RTQ and intake links
  // never share a bucket in practice, and 10/hour is right for a one-shot
  // five-question form.
  const ip = extractClientIp(req);
  const rl = await checkIntakeSubmitRateLimit(`${token}:${ip}`);
  if (!rl.allowed) {
    return rateLimitErrorResponse(rl, "Too many submit requests. Please slow down.");
  }

  // 2. Load + classify the token.
  const row = await loadQuestionnaireByToken(token);
  const verdict = classifyToken(row, new Date());
  if (!verdict.ok) {
    if (verdict.reason === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (verdict.reason === "expired") {
      return NextResponse.json({ error: "This link has expired." }, { status: 410 });
    }
    return NextResponse.json(
      { error: "This questionnaire has already been submitted." },
      { status: 409 },
    );
  }
  // classifyToken only returns ok:true for a non-null row.
  const questionnaire = row!;

  // 3. Firm-active gate -- a firm whose subscription lapsed should not
  // accept new live planning writes. Checked after the token is confirmed
  // live and before any write.
  //
  // MUST be the NoSession variant. This route is unauthenticated by design, so
  // `auth()` yields userId === null on every real request; the session-bound
  // requireActiveSubscriptionForFirm opens with `if (!userId) throw new
  // UnauthorizedError()` (authz.ts, pinned by authz.test.ts "no userId throws
  // UnauthorizedError"), which the catch below does NOT handle -- it would 500
  // every submission. Do not "align" this with the advisor routes.
  try {
    await requireActiveSubscriptionForFirmNoSession(questionnaire.firmId);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Subscription inactive." }, { status: 403 });
    }
    throw e;
  }

  // 4. Body validation. RTQ_SUBMIT_SCHEMA (bare -- no `subject`, no
  // `clientId`) is the whole route's authority boundary: everything about
  // who this submission belongs to comes from the token's row, never the
  // request body.
  //
  // req.json() is guarded: on a public surface a malformed or absent body is a
  // caller error (400), not a server error. Unguarded it throws SyntaxError,
  // which nothing here catches -> 500. Mirrors intake/[token]/submit/route.ts.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RTQ_SUBMIT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { answers, environmentNote } = parsed.data;

  if (!isCompleteRtq(answers)) {
    return NextResponse.json({ error: "Questionnaire incomplete" }, { status: 400 });
  }
  const score = scoreRtq(answers);

  // 5. One transaction for the score lookup (which locks the profile row
  // first), the questionnaire write, and the recompute -- Task 14 ruling 2.
  // A throw after the questionnaire row commits alone would leave an
  // orphaned `applied` row whose score never reached the profile, which a
  // later spouse submission's lookup would then read as legitimate.
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      const { existingPrimaryScore, existingSpouseScore } = await loadExistingScores(tx, {
        clientId: questionnaire.clientId,
        firmId: questionnaire.firmId,
        subject: questionnaire.subject,
      });

      // The status predicate is the concurrency guard, and it has to live in the
      // WHERE -- the step-2 classifyToken check is a read, so two simultaneous
      // submissions both pass it, then both write `applied` and both recompute,
      // double-applying one client's answers and double-logging the suitability
      // history. Here Postgres serializes: the second UPDATE blocks on the first's
      // row lock, re-evaluates this predicate against the committed row, and
      // matches nothing. Zero rows back means someone else claimed it -> 409.
      const [claimed] = await tx
        .update(riskQuestionnaires)
        .set({
          status: "applied",
          answers,
          score,
          environmentNote: environmentNote ?? null,
          submittedAt: now,
          appliedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(riskQuestionnaires.id, questionnaire.id),
            inArray(riskQuestionnaires.status, [...OPEN_RTQ_STATUSES]),
          ),
        )
        .returning({ id: riskQuestionnaires.id });

      if (!claimed) throw new AlreadySubmittedError();

      return recomputeProfileTx(tx, {
        clientId: questionnaire.clientId,
        firmId: questionnaire.firmId,
        // Null actor is load-bearing: it is what makes the history row read
        // "Client" rather than "System" (risk-history-table.tsx).
        actorUserId: null,
        kind: "rtq_completed",
        reason: "Client-completed questionnaire",
        patch: {
          ...applyRtqPatch({
            subject: questionnaire.subject,
            score,
            existingPrimaryScore,
            existingSpouseScore,
          }),
          toleranceSource: "rtq_client",
        },
      });
    });
  } catch (e) {
    if (e instanceof AlreadySubmittedError) {
      return NextResponse.json(
        { error: "This questionnaire has already been submitted." },
        { status: 409 },
      );
    }
    throw e;
  }

  // 6. Audit -- outside the transaction, never hold a DB transaction open
  // across an unrelated write. actorKind "client" + no actorId lets
  // recordAudit resolve the actor itself; auth() returns a null userId on
  // this public route and it falls through to "system" (same precedent as
  // src/app/api/portal/settings/route.ts).
  await recordAudit({
    action: "risk_profile.rtq_completed",
    resourceType: "client_risk_profile",
    resourceId: questionnaire.clientId,
    clientId: questionnaire.clientId,
    firmId: questionnaire.firmId,
    actorKind: "client",
    metadata: { source: "client", subject: questionnaire.subject },
  });

  return NextResponse.json({ ok: true });
}
