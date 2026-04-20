import { installClerkAdvisorFallback, type AdvisorContext } from '@foundry/auth';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { impersonationSessionRepo } from './impersonation-session-repo-singleton';

let installed = false;
export function ensureClerkFallbackInstalled() {
  if (installed) return;
  installed = true;
  installClerkAdvisorFallback(async (): Promise<AdvisorContext> => {
    // Primary: header from middleware => impersonated context
    const hdrs = await headers();
    const sessionId = hdrs.get('x-impersonation-session-id');
    if (sessionId) {
      const session = await impersonationSessionRepo.loadActive(sessionId);
      if (session) {
        return {
          kind: 'impersonated',
          clerkUserId: session.advisorClerkUserId,
          firmId: session.firmId,
          actorAdminId: session.actorAdminId,
          sessionId: session.sessionId,
          role: session.role,
        };
      }
      // Header present but session invalid (race): fall through to Clerk.
    }
    const { userId, orgId } = await auth();
    if (!userId || !orgId) throw new Error('No Clerk session — route should redirect before calling firm-id helpers');
    return { kind: 'advisor', clerkUserId: userId, firmId: orgId };
  });
}
