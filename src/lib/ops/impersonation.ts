import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

const DEFAULT_TTL_SECONDS = 600; // ~10 min (spec §2)
// Clerk's default lifetime for the session an actor token opens; we never set
// sessionMaxDurationInSeconds, so an impersonation can act for at most the
// token's TTL (time to redeem it) plus this — 40 minutes after it started.
const ACTOR_SESSION_SECONDS = 30 * 60;
const IMPERSONATION_WINDOW_MS = (DEFAULT_TTL_SECONDS + ACTOR_SESSION_SECONDS) * 1000;

/**
 * Mint a Clerk actor token to impersonate `advisorUserId`, acting as `opsUserId`.
 * Returns the Clerk sign-in URL the operator's browser should be redirected to;
 * the resulting advisor session carries an `actor` claim = the ops user, so
 * attribution is intrinsic (see recordAudit's resolver). Audited as `started`
 * BEFORE the URL guard, so an attempt is always on record.
 */
export async function startImpersonation(args: {
  firmId: string;
  advisorUserId: string;
  opsUserId: string;
  reason: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { firmId, advisorUserId, opsUserId, reason, ttlSeconds = DEFAULT_TTL_SECONDS } = args;
  const cc = await clerkClient();
  const token = await cc.actorTokens.create({
    userId: advisorUserId,
    actor: { sub: opsUserId },
    expiresInSeconds: ttlSeconds,
  });
  await recordAudit({
    action: "ops.impersonation.started",
    resourceType: "user",
    resourceId: advisorUserId,
    firmId,
    actorId: opsUserId,
    metadata: { reason, advisorUserId },
  });
  if (!token.url) {
    throw new Error("Clerk did not return an impersonation sign-in URL.");
  }
  return token.url;
}

/**
 * Best-effort audit when an operator ends an impersonation session. The caller
 * runs inside the impersonated advisor session, so the ops user is resolved
 * from the actor claim by the caller (passed in here explicitly).
 */
export async function recordImpersonationEnded(args: {
  firmId: string;
  advisorUserId: string;
  opsUserId: string;
}): Promise<void> {
  const { firmId, advisorUserId, opsUserId } = args;
  await recordAudit({
    action: "ops.impersonation.ended",
    resourceType: "user",
    resourceId: advisorUserId,
    firmId,
    actorId: opsUserId,
    metadata: { advisorUserId },
  });
}

/**
 * The ops impersonation of `firmId` that may still be live at `at`: the latest
 * `started` row within the session window with no later `ended` row for the
 * same operator and advisor. A HINT for audit rows written from Clerk webhooks,
 * which never say who made a change — not attribution. Best-effort: a failed
 * lookup is logged and returns null.
 */
export async function findOpenImpersonation(
  firmId: string,
  at: Date,
): Promise<{ opsUserId: string; startedAuditId: string } | null> {
  const since = new Date(at.getTime() - IMPERSONATION_WINDOW_MS);
  try {
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorId: auditLog.actorId,
        resourceId: auditLog.resourceId,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.firmId, firmId),
          inArray(auditLog.action, ["ops.impersonation.started", "ops.impersonation.ended"]),
          gte(auditLog.createdAt, since),
        ),
      );
    const isEnded = (start: (typeof rows)[number]) =>
      rows.some(
        (r) =>
          r.action === "ops.impersonation.ended" &&
          r.actorId === start.actorId &&
          r.resourceId === start.resourceId &&
          r.createdAt > start.createdAt,
      );
    const open = rows
      .filter((r) => r.action === "ops.impersonation.started" && r.createdAt >= since)
      .filter((r) => !isEnded(r))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return open ? { opsUserId: open.actorId, startedAuditId: open.id } : null;
  } catch (err) {
    console.error(
      `[impersonation] open-session lookup failed for firm ${firmId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
