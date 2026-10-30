// src/lib/workspace/impersonation.ts
import { auth } from "@clerk/nextjs/server";

/**
 * True in an ops "sign in as" session: Clerk puts the operator in the
 * session's `actor` claim (see `src/lib/ops/impersonation.ts`).
 */
export async function isImpersonating(): Promise<boolean> {
  return (await auth()).actor != null;
}
