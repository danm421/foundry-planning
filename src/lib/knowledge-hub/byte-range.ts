// src/lib/knowledge-hub/byte-range.ts
//
// Parses a video request's Range header into one byte window of at most
// MAX_CHUNK_BYTES. Small windows keep every response under Vercel's 4.5 MB
// function body limit; a server may return less than an open-ended range
// asks for, and the player simply asks again from where it got to.

export const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

/** null = unsatisfiable (answer 416). A missing or malformed header is read
 *  as "bytes=0-" — only <video> calls these routes, and it always sends one. */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)/);
  let start: number;
  let end: number;
  if (!m || (m[1] === "" && m[2] === "")) {
    start = 0;
    end = size - 1;
  } else if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return null;
  return { start, end: Math.min(end, start + MAX_CHUNK_BYTES - 1) };
}
