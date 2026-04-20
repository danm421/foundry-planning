import { AsyncLocalStorage } from 'node:async_hooks';
import type { AdminRole } from './context';

export type { AdminRole };

export type AdvisorContext =
  | { kind: 'advisor'; clerkUserId: string; firmId: string }
  | {
      kind: 'impersonated';
      clerkUserId: string;
      firmId: string;
      actorAdminId: string;
      sessionId: string;
      role: AdminRole;
    };

const store = new AsyncLocalStorage<AdvisorContext>();

export function runWithAdvisorContext<T>(ctx: AdvisorContext, fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve(store.run(ctx, fn));
}

export async function getAdvisorContext(): Promise<AdvisorContext> {
  const ctx = store.getStore();
  if (!ctx) {
    throw new Error('No advisor context set. apps/web middleware must populate via runWithAdvisorContext() before handlers run, or a Clerk-backed fallback must be installed.');
  }
  return ctx;
}

type ClerkFallback = () => Promise<AdvisorContext>;
let clerkFallback: ClerkFallback | null = null;

export function installClerkAdvisorFallback(fn: ClerkFallback): void {
  clerkFallback = fn;
}

export async function getAdvisorContextOrFallback(): Promise<AdvisorContext> {
  const ctx = store.getStore();
  if (ctx) return ctx;
  if (!clerkFallback) throw new Error('No advisor context and no Clerk fallback installed.');
  return clerkFallback();
}
