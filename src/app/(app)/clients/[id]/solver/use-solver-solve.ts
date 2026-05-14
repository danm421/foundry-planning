// src/app/(app)/clients/[id]/solver/use-solver-solve.ts
//
// Client-side SSE consumer for the goal-seek solver. POSTs the solve request
// and reads the event-stream response, dispatching progress / result / error
// events to caller-supplied callbacks. Returns a controller with a start()
// and cancel() API so the workspace can drive it imperatively.

"use client";

import { useCallback, useRef, useState } from "react";
import type {
  SolveLeverKey,
  SolveProgressEvent,
  SolveResultEvent,
} from "@/lib/solver/solve-types";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";

export interface UseSolverSolveOptions {
  clientId: string;
  onProgress?: (event: SolveProgressEvent) => void;
  onResult?: (event: SolveResultEvent) => void;
  onError?: (message: string) => void;
}

export interface StartArgs {
  source: SolverSource;
  mutations: SolverMutation[];
  target: SolveLeverKey;
  targetPoS: number;
}

export interface SolverSolveController {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  errorMessage: string | null;
  start: (args: StartArgs) => Promise<void>;
  cancel: () => void;
}

interface ParsedEvent {
  event: string;
  data: string;
}

/** Parse SSE chunks (event: NAME\ndata: JSON\n\n) into discrete events. */
function* parseSseStream(buffer: string): Generator<ParsedEvent, string> {
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

export function useSolverSolve(options: UseSolverSolveOptions): SolverSolveController {
  const [status, setStatus] = useState<SolverSolveController["status"]>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus((s) => (s === "running" ? "cancelled" : s));
  }, []);

  const start = useCallback(
    async (args: StartArgs) => {
      cancel();
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus("running");
      setErrorMessage(null);
      let res: Response;
      try {
        res = await fetch(`/api/clients/${options.clientId}/solver/solve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
          signal: ac.signal,
        });
      } catch (err) {
        if (ac.signal.aborted) {
          setStatus("cancelled");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
        options.onError?.(msg);
        return;
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        const msg = text || `HTTP ${res.status}`;
        setStatus("error");
        setErrorMessage(msg);
        options.onError?.(msg);
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
              options.onProgress?.(JSON.parse(ev.data) as SolveProgressEvent);
            } else if (ev.event === "result") {
              options.onResult?.(JSON.parse(ev.data) as SolveResultEvent);
            } else if (ev.event === "error") {
              const parsed = JSON.parse(ev.data) as { message: string };
              setStatus("error");
              setErrorMessage(parsed.message);
              options.onError?.(parsed.message);
            }
            next = it.next();
          }
          buffer = next.value as string;
        }
        setStatus((s) => (s === "running" ? "done" : s));
      } catch (err) {
        if (ac.signal.aborted) {
          setStatus("cancelled");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
        options.onError?.(msg);
      }
    },
    [options, cancel],
  );

  return { status, errorMessage, start, cancel };
}
