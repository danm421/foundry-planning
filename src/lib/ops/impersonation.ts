import { clerkClient } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";

const DEFAULT_TTL_SECONDS = 600; // ~10 min (spec §2)

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
