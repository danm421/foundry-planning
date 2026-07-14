"use client";

// Life-insurance need-over-time solve hook.
//
// Owns a POST fetch-stream to the over-time SSE route — which runs one
// straight-line bisection solve per plan year per decedent — exposing the
// streamed progress and the terminal result rows.
//
// The solve auto-runs, mirroring `useLiNeedSolve`: once when `enabled` flips
// true (the Life Insurance Need report becomes active) and, while enabled,
// debounced on every `assumptions` change. The computation is expensive
// (40–60 engine runs), so a completed-run signature guards the enable edge —
// re-opening the report with unchanged assumptions reuses the existing rows
// instead of re-solving. Deactivating the report aborts any in-flight run.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";

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

const DEBOUNCE_MS = 600;

export interface NeedOverTimeState {
  rows: NeedOverTimeRow[] | null;
  isRunning: boolean;
  progress: OverTimeProgress | null;
  errorMessage: string | null;
}

export function useNeedOverTime(
  clientId: string,
  assumptions: LiAssumptions,
  enabled: boolean,
  /** Live solver source (base | scenario id) + unsaved mutations, so the need
   *  curve reflects the plan the advisor is editing — not the base case. */
  source: SolverSource,
  mutations: SolverMutation[],
): NeedOverTimeState {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OverTimeProgress | null>(null);
  const [rows, setRows] = useState<NeedOverTimeRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Signature of the (source + mutations + assumptions) that produced the
  // current `rows` — set only when a run's terminal `result` event lands, so
  // canceled or failed runs re-solve on the next enable edge, and any scenario
  // edit re-solves.
  const lastCompletedKeyRef = useRef<string | null>(null);

  // Abort any in-flight run when the consumer unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    (a: LiAssumptions, src: SolverSource, muts: SolverMutation[]) => {
    void (async () => {
      // Tear down any prior run before starting a fresh one.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const key = JSON.stringify({ source: src, mutations: muts, assumptions: a });

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
            body: JSON.stringify({ source: src, mutations: muts, assumptions: a }),
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
              lastCompletedKeyRef.current = key;
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
  }, [clientId]);

  // Mirrors the latest inputs so the enable-edge run reads current values
  // without re-running when only they change (edits ride the debounce effect).
  const assumptionsRef = useRef(assumptions);
  assumptionsRef.current = assumptions;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  // Run on each false→true edge — populate the chart whenever the report
  // becomes active — unless the current rows already match these inputs.
  // Deactivating aborts any in-flight run.
  const wasEnabledRef = useRef(false);
  useEffect(() => {
    if (enabled && !wasEnabledRef.current) {
      wasEnabledRef.current = true;
      const key = JSON.stringify({
        source: sourceRef.current,
        mutations: mutationsRef.current,
        assumptions: assumptionsRef.current,
      });
      if (key !== lastCompletedKeyRef.current) {
        run(assumptionsRef.current, sourceRef.current, mutationsRef.current);
      }
    } else if (!enabled) {
      wasEnabledRef.current = false;
      abortRef.current?.abort();
    }
    // Inputs are intentionally not deps — the edge run reads the latest values
    // via refs; edits ride the debounce effect below.
  }, [enabled, run]);

  // Debounced re-run on any source / mutation / assumptions edit while enabled.
  // Skips the run that coincides with the enable edge (the effect above already
  // handled it) so the edge never double-fires.
  const skipNextDebounceRef = useRef(true);
  useEffect(() => {
    if (!enabled) {
      skipNextDebounceRef.current = true;
      return;
    }
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const key = JSON.stringify({ source, mutations, assumptions });
      if (key !== lastCompletedKeyRef.current) {
        run(assumptions, source, mutations);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [assumptions, source, mutations, enabled, run]);

  return { rows, isRunning, progress, errorMessage };
}
