// src/domain/copilot/context.ts
import type { CopilotAuthContext } from "./state";

export type { CopilotAuthContext } from "./state";

/**
 * Everything a tool needs, all derived server-side. The model never supplies
 * scope; tools read `ctx` for firm/client/scenario and `conversationId` for
 * audit + output ownership.
 */
export type CopilotToolContext = {
  ctx: CopilotAuthContext;
  /** thread id of the current conversation (= checkpointer thread_id). */
  conversationId: string;
};

export function buildToolContext(
  ctx: CopilotAuthContext,
  conversationId: string,
): CopilotToolContext {
  return { ctx, conversationId };
}
