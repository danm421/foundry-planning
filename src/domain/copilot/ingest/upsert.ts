import { db } from "@/db";
import { planningKbChunks } from "@/db/schema";
import type { KbSource } from "../tools/knowledge"; // shared union (Task 7 — already exists)

export type KbChunkRow = {
  source: KbSource;
  sourceRef: string;
  firmId: string | null;
  clientId: string | null;
  chunkText: string;
  contentHash: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

/** Idempotent insert. The unique content_hash index makes re-ingest a no-op for
 *  unchanged chunks — onConflictDoNothing skips them silently. */
export async function upsertChunk(row: KbChunkRow): Promise<void> {
  await db
    .insert(planningKbChunks)
    .values({
      source: row.source,
      sourceRef: row.sourceRef,
      firmId: row.firmId,
      clientId: row.clientId,
      chunkText: row.chunkText,
      contentHash: row.contentHash,
      embedding: row.embedding,
      metadata: row.metadata,
    })
    .onConflictDoNothing({ target: planningKbChunks.contentHash });
}
