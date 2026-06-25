import { db } from "@/db";
import { forgeMeetingTranscripts } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export async function createMeetingTranscript(input: {
  clientId: string;
  householdId: string;
  firmId: string;
  conversationId?: string | null;
  rawText: string;
  source?: "paste" | "explicit";
}): Promise<{ id: string; wordCount: number }> {
  const wordCount = countWords(input.rawText);
  const [row] = await db
    .insert(forgeMeetingTranscripts)
    .values({
      clientId: input.clientId,
      householdId: input.householdId,
      firmId: input.firmId,
      conversationId: input.conversationId ?? null,
      rawText: input.rawText,
      wordCount,
      source: input.source ?? "paste",
    })
    .returning({ id: forgeMeetingTranscripts.id });
  return { id: row.id, wordCount };
}

/** IDOR-gated read: scoped to (id, clientId, firmId) — a model-echoed id can
 *  never resolve a transcript outside the conversation's client/firm. */
export async function getOwnedMeetingTranscript(
  id: string,
  clientId: string,
  firmId: string,
): Promise<{ id: string; householdId: string; rawText: string; wordCount: number } | null> {
  const row = await db.query.forgeMeetingTranscripts.findFirst({
    where: and(
      eq(forgeMeetingTranscripts.id, id),
      eq(forgeMeetingTranscripts.clientId, clientId),
      eq(forgeMeetingTranscripts.firmId, firmId),
    ),
    columns: { id: true, householdId: true, rawText: true, wordCount: true },
  });
  return row ?? null;
}

export async function deleteMeetingTranscript(id: string): Promise<void> {
  await db.delete(forgeMeetingTranscripts).where(eq(forgeMeetingTranscripts.id, id));
}
