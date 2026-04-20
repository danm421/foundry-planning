import { AsyncLocalStorage } from "node:async_hooks";

export type AdminRole = "support" | "operator" | "superadmin";

export type ActingContext = {
  actorAdminId: string;
  role: AdminRole;
  impersonation:
    | null
    | {
        sessionId: string;
        advisorClerkUserId: string;
        firmId: string;
      };
};

const storage = new AsyncLocalStorage<ActingContext>();

export function runWithActingContext<T>(
  ctx: ActingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getCurrentActingContext(): ActingContext | undefined {
  return storage.getStore();
}
