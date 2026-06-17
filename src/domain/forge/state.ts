// src/domain/copilot/state.ts
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/**
 * Everything the copilot graph + tools need to scope every read/write, derived
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

/**
 * Graph state. `...MessagesAnnotation.spec` gives the standard append/merge
 * message-log reducer (the FULL thread is checkpointed); `authContext` is a
 * single last-write-wins channel carried through every node.
 */
export const ForgeState = Annotation.Root({
  ...MessagesAnnotation.spec,
  authContext: Annotation<ForgeAuthContext>({ reducer: (_, b) => b }),
});
