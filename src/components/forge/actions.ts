// src/components/forge/actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import {
  listMyConversations as listConversationsForUser,
  userOwnsConversation,
} from "@/domain/forge/conversations";
import { getCheckpointer } from "@/domain/forge/checkpointer";
import { toUiMessages } from "@/domain/forge/transcript";
import type { WritePreview } from "@/domain/forge/types";

/** Thread list for the signed-in advisor (panel calls this with no args). */
export async function listMyConversations() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const firmId = await requireOrgId();
  return listConversationsForUser(userId, firmId);
}

export interface LoadedConversation {
  messages: ReturnType<typeof toUiMessages>;
  approval: { previews: WritePreview[]; calls: { id: string; name: string; args: unknown }[] } | null;
}

/** Reload one thread's checkpointed messages + any pending approval (IDOR-checked). */
export async function loadConversationMessages(conversationId: string): Promise<LoadedConversation> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  await requireOrgId();
  if (!(await userOwnsConversation(conversationId, userId))) {
    throw new Error("Conversation not found");
  }
  const checkpointer = getCheckpointer();
  const tuple = await checkpointer.getTuple({ configurable: { thread_id: conversationId } });
  // channel_values is Record<string, unknown> per CheckpointTuple type
  const channelMessages = (tuple?.checkpoint?.channel_values?.messages ?? []) as unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = toUiMessages(channelMessages as any);
  // pendingWrites is CheckpointPendingWrite[] = [taskId, channel, value][]
  // A pending HITL interrupt is stored with channel "__interrupt__"
  const pending = tuple?.pendingWrites?.find(([, channel]) => channel === "__interrupt__");
  const approval = pending ? (pending[2] as LoadedConversation["approval"]) : null;
  return { messages, approval };
}

/**
 * Resolve the client's base-case scenario id for the forge document import.
 * The chat always imports against the base case (factual data), regardless of
 * which scenario the panel is viewing. Returns null when the client is
 * inaccessible or has no base case — the caller surfaces that as an error.
 */
export async function resolveBaseScenarioId(clientId: string): Promise<string | null> {
  const firmId = await requireOrgId();
  return baseCaseScenarioId(clientId, firmId);
}
