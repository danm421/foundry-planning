import { createHash } from "node:crypto";

// SOFT / confirm-at-ingest: size/overlap (token-ish word window). Defaults are a
// starting point; the seed ingest (Task 6) confirms them empirically.
export type ChunkParams = { size: number; overlap: number };
export const DEFAULT_CHUNK_PARAMS: ChunkParams = { size: 220, overlap: 40 };

export function chunkText(body: string, params: ChunkParams = DEFAULT_CHUNK_PARAMS): string[] {
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, params.size - params.overlap);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    out.push(words.slice(i, i + params.size).join(" "));
    if (i + params.size >= words.length) break;
  }
  return out;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
