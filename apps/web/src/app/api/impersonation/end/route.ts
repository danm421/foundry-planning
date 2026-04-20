import { NextRequest, NextResponse } from 'next/server';
import { getAdvisorContextOrFallback } from '@foundry/auth';
import { defaultAuditInserter } from '@foundry/db/admin-scope';
import { impersonationSessionRepo } from '@/lib/impersonation-session-repo-singleton';

export const runtime = 'nodejs';

const COOKIE = 'foundry_impersonation';

export async function POST(_req: NextRequest) {
  // Use OrFallback variant: in production the incoming request carries the
  // foundry_impersonation cookie which middleware validated and header-injected
  // into ALS. The OrFallback path handles the rare edge case where ALS isn't
  // populated yet (e.g. direct lambda cold-start without middleware).
  const ctx = await getAdvisorContextOrFallback();
  if (ctx.kind !== 'impersonated') {
    return new NextResponse('not impersonated', { status: 400 });
  }

  await impersonationSessionRepo.end(ctx.sessionId);

  // writeAuditLog from admin-scope reads actor fields from the admin ActingContext
  // ALS, which is NOT populated here (this is the advisor-facing web app). Call
  // the inserter directly instead, assembling the row from the AdvisorContext.
  await defaultAuditInserter({
    firmId: ctx.firmId,
    actorId: ctx.actorAdminId,
    actingAsAdvisorId: ctx.clerkUserId,
    impersonationSessionId: ctx.sessionId,
    action: 'impersonation.end',
    resourceType: 'impersonation_session',
    resourceId: ctx.sessionId,
    clientId: null,
    metadata: null,
  });

  const adminUrl = process.env.ADMIN_APP_URL ?? '/';
  const res = NextResponse.redirect(new URL('/', adminUrl), 302);
  res.cookies.set({ name: COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
