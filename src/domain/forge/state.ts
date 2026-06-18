// src/domain/forge/state.ts
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/**
 * Everything the forge graph + tools need to scope every read/write, derived
 * SERVER-SIDE from the request (Clerk org/user + the URL's client/scenario).
 * The model NEVER supplies any of these — it cannot widen its own scope.
 */
export type ForgeAuthContext = {
  /** Clerk userId of the advisor running the conversation. */
  userId: string;
  /** Clerk orgId — the tenant. Maps to `clients.firmId` / `firmId` args. */
  firmId: string;
  /** The active client (household) this conversation is scoped to. */
  clientId: string;
  /** The active scenario; `"base"` is the canonical base-case ref. */
  scenarioId: string;
};

export type VerifyDecision = "pass" | "retry" | "caveat";

/**
 * Graph state. `...MessagesAnnotation.spec` gives the standard append/merge
 * message-log reducer (the FULL thread is checkpointed); `authContext` is a
 * single last-write-wins channel carried through every node.
 */
export const ForgeState = Annotation.Root({
  ...MessagesAnnotation.spec,
  authContext: Annotation<ForgeAuthContext>({ reducer: (_, b) => b }),
  // How many times the verify node has bounced this turn's answer back for a
  // rewrite. Seeded to 0 by the stream route on every POST so the budget resets
  // per user turn (checkpointed state would otherwise carry it across turns).
  verifyAttempts: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  // The verify node's routing decision, read by the verify→(agent|END) edge.
  verifyDecision: Annotation<VerifyDecision | null>({ reducer: (_, b) => b, default: () => null }),
});
