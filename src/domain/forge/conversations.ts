// src/domain/forge/conversations.ts
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { forgeConversations } from "@/db/schema";
import { purgeForgeHistory } from "./purge-history";

/**
 * Create a chat thread. Returns the new conversation id (= checkpointer
 * thread_id). Org + user scoped; `clientId` is set by the stream route to the
 * active client so the thread list can be filtered per client later.
 */
export async function createConversation(input: {
  userId: string;
  firmId: string;
  clientId?: string;
  title?: string;
}): Promise<string> {
  const [row] = await db
    .insert(forgeConversations)
    .values({
      userId: input.userId,
      firmId: input.firmId,
      clientId: input.clientId ?? null,
      title: input.title ?? "New conversation",
    })
    .returning({ id: forgeConversations.id });
  return row.id;
}

/** List the caller's own threads, newest-touched first. Org + user scoped.
 *  - Pass a `clientId` string to narrow to threads for a single client.
 *  - Pass `null` to return ONLY clientless (global) threads (IS NULL in SQL,
 *    applied before `.limit(50)` so the limit never truncates global threads away).
 *  - Omit / pass `undefined` to return all threads regardless of clientId. */
export async function listMyConversations(userId: string, firmId: string, clientId?: string | null) {
  const baseFilter = and(eq(forgeConversations.userId, userId), eq(forgeConversations.firmId, firmId));
  const where =
    clientId === null
      ? and(baseFilter, isNull(forgeConversations.clientId))
      : typeof clientId === "string"
        ? and(baseFilter, eq(forgeConversations.clientId, clientId))
        : baseFilter;
  return db
    .select({
      id: forgeConversations.id,
      title: forgeConversations.title,
      clientId: forgeConversations.clientId,
      updatedAt: forgeConversations.updatedAt,
    })
    .from(forgeConversations)
    .where(where)
    .orderBy(desc(forgeConversations.updatedAt))
    .limit(50);
}

/**
 * Bump `updatedAt` (and optionally the title) — but ONLY for the owner. The
 * userId predicate makes a non-owner call a silent no-op rather than a leak.
 */
export async function touchConversation(id: string, userId: string, title?: string): Promise<void> {
  await db
    .update(forgeConversations)
    .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
    .where(and(eq(forgeConversations.id, id), eq(forgeConversations.userId, userId)));
}

/**
 * Scope guard for every path that reads or continues a thread: the thread's
 * client (null = global) when `userId` owns `id` in `firmId` (the caller's
 * active org), else null → 404. Callers then pin `clientId` to their own scope
 * — the URL client, null on the global routes, or a fresh client-access check.
 * Only the id's stored spelling matches: callers key the thread's chat history
 * by the id they were sent, and purgeForgeHistory erases it by this spelling.
 */
export async function findOwnedConversation(
  id: string,
  userId: string,
  firmId: string,
): Promise<{ clientId: string | null } | null> {
  const [row] = await db
    .select({ clientId: forgeConversations.clientId })
    .from(forgeConversations)
    .where(
      and(
        eq(forgeConversations.id, id),
        eq(sql`${forgeConversations.id}::text`, id),
        eq(forgeConversations.userId, userId),
        eq(forgeConversations.firmId, firmId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Rename a thread (owner-only no-op for non-owners). Does NOT bump updatedAt. */
export async function renameConversation(id: string, userId: string, title: string): Promise<void> {
  await db
    .update(forgeConversations)
    .set({ title })
    .where(and(eq(forgeConversations.id, id), eq(forgeConversations.userId, userId)));
}

/** Delete a thread and its chat history (owner-only no-op for non-owners). */
export async function deleteConversation(id: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(forgeConversations)
      .where(and(eq(forgeConversations.id, id), eq(forgeConversations.userId, userId)))
      .returning({ id: forgeConversations.id });
    if (deleted.length > 0) await purgeForgeHistory(tx, { conversationId: id });
  });
}
