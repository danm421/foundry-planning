// src/components/fact-finder/sse.ts
// Server-sent events, as the fact finder's streaming routes (read, turn) write them.

/**
 * Yields each complete `data: <json>\n\n` frame in the buffer and returns the
 * unfinished tail, which the caller carries into the next chunk.
 */
export function* parseSse<F>(buffer: string): Generator<F, string> {
  let cursor = 0;
  for (;;) {
    const boundary = buffer.indexOf("\n\n", cursor);
    if (boundary === -1) return buffer.slice(cursor);
    const block = buffer.slice(cursor, boundary);
    cursor = boundary + 2;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) data += line.slice("data: ".length);
    }
    if (data) {
      try {
        yield JSON.parse(data) as F;
      } catch {
        // A malformed frame shouldn't end the read; skip it.
      }
    }
  }
}
