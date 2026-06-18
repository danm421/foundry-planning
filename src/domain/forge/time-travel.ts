// Undo + debug replay over the checkpoints PostgresSaver already persists. Read +
// rewind only. Scope MUST be re-validated by the caller (the undo route reuses
// the resume route's two IDOR pins) before any updateState.
import type { ForgeAuthContext } from "./state";

export interface CheckpointSummary {
  checkpointId: string;
  createdAt: string;
  messageCount: number;
}

interface CompiledGraphLike {
  getStateHistory: (config: { configurable: { thread_id: string } }) => AsyncIterable<{
    config?: { configurable?: { checkpoint_id?: string } };
    createdAt?: string;
    values?: { messages?: unknown[] };
  }>;
  updateState: (
    config: { configurable: { thread_id: string; checkpoint_id?: string } },
    values: Record<string, unknown>,
  ) => Promise<unknown>;
}

export async function listCheckpoints(
  conversationId: string,
  graph: CompiledGraphLike,
): Promise<CheckpointSummary[]> {
  const out: CheckpointSummary[] = [];
  for await (const snap of graph.getStateHistory({ configurable: { thread_id: conversationId } })) {
    out.push({
      checkpointId: snap.config?.configurable?.checkpoint_id ?? "",
      createdAt: snap.createdAt ?? "",
      messageCount: snap.values?.messages?.length ?? 0,
    });
  }
  return out;
}

/**
 * Revert the conversation to a prior checkpoint. Caller MUST have already
 * verified ownership + the checkpoint's authContext clientId/userId (see the
 * undo route). authContext is reasserted into state so a resumed turn keeps the
 * original scope.
 */
export async function undoToCheckpoint(
  conversationId: string,
  checkpointId: string,
  authContext: ForgeAuthContext,
  graph: CompiledGraphLike,
): Promise<void> {
  await graph.updateState(
    { configurable: { thread_id: conversationId, checkpoint_id: checkpointId } },
    { authContext },
  );
}
