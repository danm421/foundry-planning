import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { getActingContext, signImpersonationToken } from '@foundry/auth';
import type { AdminRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { adminImpersonationSessions, auditLog } from '@foundry/db/schema';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Resolve the acting admin context (does NOT require an active impersonation)
  const clerkUser = await currentUser();
  const clerkSession = clerkUser
    ? {
        userId: clerkUser.id,
        emailAddress: clerkUser.emailAddresses[0]?.emailAddress ?? '',
        role: (clerkUser.publicMetadata?.role as AdminRole | undefined),
      }
    : null;

  let ctx: Awaited<ReturnType<typeof getActingContext>>;
  try {
    ctx = await getActingContext({ clerkSession, repo: drizzleAdminUserRepo });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { advisorClerkUserId, firmId, reason } = body as {
    advisorClerkUserId?: string;
    firmId?: string;
    reason?: string;
  };

  if (!advisorClerkUserId || !firmId || !reason?.trim()) {
    return NextResponse.json(
      { error: 'advisorClerkUserId, firmId, and reason are required' },
      { status: 400 },
    );
  }

  const secret = process.env.IMPERSONATION_SIGNING_SECRET;
  const webUrl = process.env.WEB_APP_URL;
  if (!secret || !webUrl) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  const { token, tokenHash } = await signImpersonationToken(
    { sessionId, actorAdminId: ctx.actorAdminId, advisorClerkUserId, firmId },
    secret,
  );

  await adminQuery(ctx, async () => {
    // Insert the impersonation session row
    await db.insert(adminImpersonationSessions).values({
      id: sessionId,
      adminUserId: ctx.actorAdminId,
      advisorClerkUserId,
      firmId,
      expiresAt,
      reason: reason.trim(),
      handoffTokenHash: tokenHash,
    });

    // Insert audit log for impersonation.start.
    // writeAuditLog requires an active impersonation context, which doesn't exist
    // yet at this point — so we insert directly with the fields we know.
    await db.insert(auditLog).values({
      firmId,
      actorId: ctx.actorAdminId,
      actingAsAdvisorId: advisorClerkUserId,
      impersonationSessionId: sessionId,
      action: 'impersonation.start',
      resourceType: 'impersonation_session',
      resourceId: sessionId,
      clientId: null,
      metadata: { reason: reason.trim() },
    });
  });

  return NextResponse.json({
    redirect: `${webUrl}/api/impersonation/handoff?t=${token}`,
  });
}
