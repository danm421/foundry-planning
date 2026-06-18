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

/**
 * Per-tool consecutive-error counter (12-factor Factors 8/9). Merges per-tool
 * counts from a node's return value; a value of 0 RESETS that tool's count (a
 * success clears the streak). Exported so it can be unit-tested directly rather
 * than poked out of the channel spec.
 */
export function mergeToolErrorCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v === 0 ? 0 : (out[k] ?? 0) + v;
  return out;
}

/**
 * Graph state. `...MessagesAnnotation.spec` gives the standard append/merge
 * message-log reducer (the FULL thread is checkpointed); `authContext` is a
 * single last-write-wins channel carried through every node; `toolErrorCounts`
 * tracks consecutive per-tool failures so the graph can escalate after N.
 */
export const ForgeState = Annotation.Root({
  ...MessagesAnnotation.spec,
  authContext: Annotation<ForgeAuthContext>({ reducer: (_, b) => b }),
  toolErrorCounts: Annotation<Record<string, number>>({
    reducer: mergeToolErrorCounts,
    default: () => ({}),
  }),
});
