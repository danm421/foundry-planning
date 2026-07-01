// src/domain/forge/context.ts
import type { ForgeAuthContext, ForgeGlobalAuthContext } from "./state";

export type { ForgeAuthContext, ForgeGlobalAuthContext } from "./state";

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

/** Everything a GLOBAL (clientless) tool needs. Mirrors ForgeToolContext but
 *  its ctx has no clientId/scenarioId — so a global tool can't read client scope. */
export type ForgeGlobalToolContext = {
  ctx: ForgeGlobalAuthContext;
  conversationId: string;
};

export function buildGlobalToolContext(
  ctx: ForgeGlobalAuthContext,
  conversationId: string,
): ForgeGlobalToolContext {
  return { ctx, conversationId };
}
