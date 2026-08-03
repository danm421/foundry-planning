"use client";

// Life Insurance solver — on-demand Monte Carlo need solve.
//
// The straight-line solve auto-runs (see `useLiNeedSolve`); the Monte Carlo
// solve never does — it is expensive (250 trials × ~24 bisection iterations ×
// up to 2 decedents), so the advisor sets a target success score and clicks
// "Solve for score", which opens an SSE stream to the solve-mc route.
//
// The workspace owns this hook so the TRIGGER can live in the left input pane
// (`LiMcControl`) while the RESULT renders in the right report pane
// (`LiNeedRange`). A run therefore survives switching tabs or reports; only
// unmounting the workspace aborts it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { parseSseStream } from "./use-need-over-time";

/** One decedent's MC solve outcome (mirrors `NeedMcResult` in solve-need-mc.ts). */
export interface NeedMcResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedScore: number;
  iterations: number;
  /** Federal + state estate tax + IRD folded into the solve target; `0`
   *  when the "Cover estate taxes" toggle is off. */
  estateTaxAddend: number;
}

/** Terminal `result` SSE payload from the solve-mc route. */
export interface McResultPayload {
  isMarried: boolean;
  client: NeedMcResult;
  spouse: NeedMcResult | null;
}

/** Streamed `progress` SSE payload. */
export interface McProgressPayload {
  case: "client" | "spouse";
  done: number;
  total: number;
}

/** MC solve state + controls, shared by the left-pane trigger and right-pane cards. */
export interface LiMcSolve {
  isSolving: boolean;
  progress: McProgressPayload | null;
  result: McResultPayload | null;
  errorMessage: string | null;
  solve(): Promise<void>;
  cancel(): void;
}

export function useLiMcSolve(
  clientId: string,
  /** Full current assumptions — POSTed as the solve-mc body's `assumptions`. */
  assumptions: LiAssumptions,
  /** Live solver source + unsaved mutations, so the MC solve reflects the
   *  edited plan — not the base case. */
  source: SolverSource,
  mutations: SolverMutation[],
): LiMcSolve {
  const [isSolving, setIsSolving] = useState(false);
  const [progress, setProgress] = useState<McProgressPayload | null>(null);
  const [result, setResult] = useState<McResultPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Abort a run in flight when the workspace goes away. Empty deps — a cleanup
  // that re-ran on every render would cancel the solve it just started.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A solved bound belongs to the inputs it came from. Editing an assumption,
  // switching source, or changing a mutation re-solves the straight-line lower
  // bound, so drop the MC upper bound (and any run still streaming) rather than
  // pair a fresh figure with a superseded one. This used to be handled by
  // `LiNeedRange` unmounting; the state now outlives that, so it is explicit.
  // Safe as an identity-keyed effect: `source` is a string, `mutations` is
  // memoized upstream, and `assumptions` is replaced only on a real edit.
  useEffect(() => {
    abortRef.current?.abort();
    setResult(null);
  }, [assumptions, source, mutations]);

  // Deps, not refs (the sibling stream hooks use refs) — the solve is
  // user-triggered, so capturing the values at click time is exactly right, and
  // the invalidation above already discards anything they superseded.
  const solve = useCallback(async () => {
    // Tear down any prior run before starting a fresh one.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setIsSolving(true);
    setProgress(null);
    setResult(null);
    setErrorMessage(null);

    let res: Response;
    try {
      res = await fetch(`/api/clients/${clientId}/life-insurance/solve-mc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, mutations, assumptions }),
        signal: ac.signal,
      });
    } catch (err) {
      if (!ac.signal.aborted) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
      setIsSolving(false);
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      setErrorMessage(text || `HTTP ${res.status}`);
      setIsSolving(false);
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
            setProgress(JSON.parse(ev.data) as McProgressPayload);
          } else if (ev.event === "result") {
            setResult(JSON.parse(ev.data) as McResultPayload);
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
      setIsSolving(false);
      setProgress(null);
    }
  }, [clientId, assumptions, source, mutations]);

  return { isSolving, progress, result, errorMessage, solve, cancel };
}
