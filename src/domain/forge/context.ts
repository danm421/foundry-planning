// src/domain/copilot/context.ts
import type { ForgeAuthContext } from "./state";

export type { ForgeAuthContext } from "./state";

/**
 * Everything a tool needs, all derived server-side. The model never supplies
 * scope; tools read `ctx` for firm/client/scenario and `conversationId` for
 * audit + output ownership.
 */
export type ForgeToolContext = {
  ctx: ForgeAuthContext;
  /** thread id of the current conversation (= checkpointer thread_id). */
  conversationId: string;
};

export function buildToolContext(
  ctx: ForgeAuthContext,
  conversationId: string,
): ForgeToolContext {
  return { ctx, conversationId };
}
