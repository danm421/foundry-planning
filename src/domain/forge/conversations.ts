// src/domain/forge/conversations.ts
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { copilotConversations } from "@/db/schema";

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
    .insert(copilotConversations)
    .values({
      userId: input.userId,
      firmId: input.firmId,
      clientId: input.clientId ?? null,
      title: input.title ?? "New conversation",
    })
    .returning({ id: copilotConversations.id });
  return row.id;
}

/** List the caller's own threads, newest-touched first. Org + user scoped. */
export async function listMyConversations(userId: string, firmId: string) {
  return db
    .select({
      id: copilotConversations.id,
      title: copilotConversations.title,
      clientId: copilotConversations.clientId,
      updatedAt: copilotConversations.updatedAt,
    })
    .from(copilotConversations)
    .where(and(eq(copilotConversations.userId, userId), eq(copilotConversations.firmId, firmId)))
    .orderBy(desc(copilotConversations.updatedAt))
    .limit(50);
}

/**
 * Bump `updatedAt` (and optionally the title) — but ONLY for the owner. The
 * userId predicate makes a non-owner call a silent no-op rather than a leak.
 */
export async function touchConversation(id: string, userId: string, title?: string): Promise<void> {
  await db
    .update(copilotConversations)
    .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
    .where(and(eq(copilotConversations.id, id), eq(copilotConversations.userId, userId)));
}

/**
 * IDOR guard for the stream/resume routes: true only when `userId` owns `id`.
 * A conversationId belonging to another user returns false → 404.
 */
export async function userOwnsConversation(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: copilotConversations.id })
    .from(copilotConversations)
    .where(and(eq(copilotConversations.id, id), eq(copilotConversations.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
