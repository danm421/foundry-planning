"use client";
// src/components/fact-finder/use-read-stream.ts
// Reads the import's documents: POST …/fact-finder/read, following its SSE
// progress frames. One read at a time — asking again while one runs queues a
// single follow-up, and the server then reads whatever still needs reading.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorResponse, ReadEvent, ReadFrame } from "@/lib/fact-finder/api-types";
import { OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";

/** A file's latest progress. */
export type ReadLine = Extract<ReadEvent, { type: "file" }>;
export type ReadDone = Extract<ReadEvent, { type: "done" }>;

const ENDED_EARLY_MESSAGE = "Reading stopped before it finished. Retry to read the rest.";

/**
 * Yields each complete `data: <json>\n\n` frame in the buffer and returns the
 * unfinished tail, which the caller carries into the next chunk. Modelled on
 * statement chat's `parseChatExtractSse`.
 */
export function* parseReadSse(buffer: string): Generator<ReadFrame, string> {
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
        yield JSON.parse(data) as ReadFrame;
      } catch {
        // A malformed frame shouldn't end the read; skip it.
      }
    }
  }
}

/** Files still "reading" when a read ends without its summary go back to what the fact finder says. */
function withoutReading(lines: Record<string, ReadLine>): Record<string, ReadLine> {
  return Object.fromEntries(Object.entries(lines).filter(([, line]) => line.status !== "reading"));
}

export interface ReadStream {
  /** Each file's latest progress this visit, by file id. */
  lines: Record<string, ReadLine>;
  running: boolean;
  /** Why the last read was refused or stopped early. */
  error: string | null;
  /** Reads now — or, while a read runs, once more after it ends. */
  start(): void;
}

export function useReadStream({
  clientId,
  importId,
  onFileFinished,
  onDone,
}: {
  clientId: string;
  importId: string;
  /** A file is done or failed. */
  onFileFinished?: (line: ReadLine) => void;
  onDone?: (done: ReadDone) => void;
}): ReadStream {
  const url = `${factFinderUrl(clientId, importId)}/read`;
  const [lines, setLines] = useState<Record<string, ReadLine>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef({ onFileFinished, onDone });
  useEffect(() => {
    handlers.current = { onFileFinished, onDone };
  });
  const active = useRef(false);
  const queued = useRef(false);

  /** One read, start to finish. Never throws; a read that ends without its summary sets `error`. */
  const readOnce = useCallback(async () => {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST" });
    } catch {
      setError(OFFLINE_MESSAGE);
      return;
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as Partial<ErrorResponse>;
      setError(refusalText(res, body.error, "Couldn't start reading"));
      return;
    }

    let ending: "done" | "error" | null = null;
    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = parseReadSse(buffer);
        let next = frames.next();
        while (!next.done) {
          const frame = next.value;
          if (frame.type === "file") {
            setLines((prev) => ({ ...prev, [frame.fileId]: frame }));
            if (frame.status !== "reading") handlers.current.onFileFinished?.(frame);
          } else if (frame.type === "done") {
            ending = "done";
            handlers.current.onDone?.(frame);
          } else {
            ending = "error";
            setError(frame.message);
          }
          next = frames.next();
        }
        buffer = next.value;
      }
    } catch {
      // The connection dropped: handled below as a read that stopped early.
    }
    if (ending === "done") return;
    if (ending === null) setError(ENDED_EARLY_MESSAGE);
    setLines(withoutReading);
  }, [url]);

  const start = useCallback(() => {
    if (active.current) {
      queued.current = true;
      return;
    }
    active.current = true;
    setRunning(true);
    void (async () => {
      do {
        queued.current = false;
        setError(null);
        await readOnce();
      } while (queued.current);
      active.current = false;
      setRunning(false);
    })();
  }, [readOnce]);

  return { lines, running, error, start };
}
