"use client";

// Life-insurance need-over-time solve hook.
//
// Owns a POST fetch-stream to the over-time SSE route — which runs one
// straight-line bisection solve per plan year per decedent — exposing the
// streamed progress, the terminal result rows, and run/cancel controls.
// The computation is expensive, so `run` only fires on an explicit caller
// action; it never auto-runs. Lifted verbatim from the former
// `li-over-time-section.tsx`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";

/** Streamed `progress` SSE payload from the over-time route. */
export interface OverTimeProgress {
  done: number;
  total: number;
}

interface ParsedEvent {
  event: string;
  data: string;
}

/** Parse SSE chunks (event: NAME\ndata: JSON\n\n) into discrete events. */
export function* parseSseStream(
  buffer: string,
): Generator<ParsedEvent, string> {
  let cursor = 0;
  while (true) {
    const boundary = buffer.indexOf("\n\n", cursor);
    if (boundary === -1) {
      return buffer.slice(cursor);
    }
    const block = buffer.slice(cursor, boundary);
    cursor = boundary + 2;
    let eventName = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice("event: ".length);
      else if (line.startsWith("data: ")) data += line.slice("data: ".length);
    }
    if (data) yield { event: eventName, data };
  }
}

export interface NeedOverTimeState {
  rows: NeedOverTimeRow[] | null;
  isRunning: boolean;
  progress: OverTimeProgress | null;
  errorMessage: string | null;
  /** Start a solve for the given assumptions; aborts any prior run. */
  run: (assumptions: LiAssumptions) => void;
  /** Abort any in-flight run. */
  cancel: () => void;
}

export function useNeedOverTime(clientId: string): NeedOverTimeState {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OverTimeProgress | null>(null);
  const [rows, setRows] = useState<NeedOverTimeRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Abort any in-flight run when the consumer unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    (assumptions: LiAssumptions) => {
      void (async () => {
        // Tear down any prior run before starting a fresh one.
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        setIsRunning(true);
        setProgress(null);
        setRows(null);
        setErrorMessage(null);

        let res: Response;
        try {
          res = await fetch(
            `/api/clients/${clientId}/life-insurance/over-time`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(assumptions),
              signal: ac.signal,
            },
          );
        } catch (err) {
          if (!ac.signal.aborted) {
            setErrorMessage(err instanceof Error ? err.message : String(err));
          }
          setIsRunning(false);
          return;
        }

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setErrorMessage(text || `HTTP ${res.status}`);
          setIsRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const it = parseSseStream(buffer);
            let next = it.next();
            while (!next.done) {
              const ev = next.value;
              if (ev.event === "progress") {
                setProgress(JSON.parse(ev.data) as OverTimeProgress);
              } else if (ev.event === "result") {
                const parsed = JSON.parse(ev.data) as {
                  rows: NeedOverTimeRow[];
                };
                setRows(parsed.rows);
              } else if (ev.event === "error") {
                const parsed = JSON.parse(ev.data) as { message: string };
                setErrorMessage(parsed.message);
              }
              next = it.next();
            }
            buffer = next.value as string;
          }
        } catch (err) {
          if (!ac.signal.aborted) {
            setErrorMessage(err instanceof Error ? err.message : String(err));
          }
        } finally {
          setIsRunning(false);
          setProgress(null);
        }
      })();
    },
    [clientId],
  );

  return { rows, isRunning, progress, errorMessage, run, cancel };
}
