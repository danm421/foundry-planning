import { chunkText, contentHash, DEFAULT_CHUNK_PARAMS, type ChunkParams } from "./chunk";
import { upsertChunk, type KbChunkRow } from "./upsert";
import { embeddings } from "../llm";
import type { KbSource } from "../tools/knowledge";

export { chunkText, contentHash, DEFAULT_CHUNK_PARAMS, upsertChunk };
export type { ChunkParams, KbChunkRow };

export type IngestDoc = {
  source: KbSource;
  sourceRef: string;
  body: string;
  firmId?: string | null;
  clientId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Chunk → hash → embed → idempotent upsert. Returns counts for CLI logging.
 *  Re-ingesting unchanged text is a no-op (content_hash conflict → skipped). */
export async function ingestDocument(
  doc: IngestDoc,
  params: ChunkParams = DEFAULT_CHUNK_PARAMS,
): Promise<{ chunks: number }> {
  const pieces = chunkText(doc.body, params);
  for (const piece of pieces) {
    const embedding = await embeddings(piece);
    await upsertChunk({
      source: doc.source,
      sourceRef: doc.sourceRef,
      firmId: doc.firmId ?? null,
      clientId: doc.clientId ?? null,
      chunkText: piece,
      contentHash: contentHash(piece),
      embedding,
      metadata: doc.metadata ?? {},
    });
  }
  return { chunks: pieces.length };
}
