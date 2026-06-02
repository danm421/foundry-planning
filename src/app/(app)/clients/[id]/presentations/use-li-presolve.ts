// src/app/(app)/clients/[id]/presentations/use-li-presolve.ts
//
// Pre-solve hook: runs the over-time SSE route then the solve-mc SSE route for
// one scenario and assembles a `LiSolved` payload from the combined results.
// Used by the Life Insurance Summary launcher to compute results before the PDF
// is rendered.
"use client";

import { useCallback, useRef, useState } from "react";
import { parseSseStream } from "@/app/(app)/clients/[id]/solver/use-need-over-time";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { LiSolved } from "@/lib/presentations/pages/life-insurance-summary/options-schema";

export interface PresolveProgress {
  scenarioLabel: string;
  phase: "over-time" | "monte-carlo";
  caseLabel?: "client" | "spouse";
  done: number;
  total: number;
}

interface McResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedScore: number;
}

async function streamSse(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const it = parseSseStream(buffer);
    let next = it.next();
    while (!next.done) {
      onEvent(next.value.event, next.value.data);
      next = it.next();
    }
    buffer = next.value as string;
  }
}

/** Solve over-time + MC for one scenario; resolves to a LiSolved payload. */
export function useLiPresolve(clientId: string) {
  const [progress, setProgress] = useState<PresolveProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const solveScenario = useCallback(
    async (
      assumptions: LiAssumptions,
      scenarioLabel: string,
      modelPortfolioLabel: string,
    ): Promise<LiSolved> => {
      const ac = new AbortController();
      abortRef.current = ac;

      // 1) over-time curve
      // Route emits: progress { done, total } · result { rows: NeedOverTimeRow[] } · error { message }
      // NeedOverTimeRow has: { year, clientNeed, spouseNeed, clientStatus, spouseStatus }
      let curveRows: LiSolved["curveRows"] = [];
      await streamSse(
        `/api/clients/${clientId}/life-insurance/over-time`,
        assumptions,
        ac.signal,
        (event, data) => {
          if (event === "progress") {
            const p = JSON.parse(data) as { done: number; total: number };
            setProgress({
              scenarioLabel,
              phase: "over-time",
              done: p.done,
              total: p.total,
            });
          } else if (event === "result") {
            const r = JSON.parse(data) as {
              rows: Array<{
                year: number;
                clientNeed: number;
                spouseNeed: number | null;
              }>;
            };
            curveRows = r.rows.map((x) => ({
              year: x.year,
              clientNeed: x.clientNeed,
              spouseNeed: x.spouseNeed,
            }));
          } else if (event === "error") {
            throw new Error(
              (JSON.parse(data) as { message: string }).message,
            );
          }
        },
      );

      // 2) MC solve
      // Route emits: progress { case: "client"|"spouse", done, total }
      //              result { isMarried, client: NeedMcResult & { estateTaxAddend }, spouse: ... | null }
      //              error { message }
      // NeedMcResult: { status, faceValue, achievedScore, iterations }
      let mcClient: McResult | null = null;
      let mcSpouse: McResult | null = null;
      await streamSse(
        `/api/clients/${clientId}/life-insurance/solve-mc`,
        assumptions,
        ac.signal,
        (event, data) => {
          if (event === "progress") {
            const p = JSON.parse(data) as {
              case: "client" | "spouse";
              done: number;
              total: number;
            };
            setProgress({
              scenarioLabel,
              phase: "monte-carlo",
              caseLabel: p.case,
              done: p.done,
              total: p.total,
            });
          } else if (event === "result") {
            const r = JSON.parse(data) as {
              isMarried: boolean;
              client: McResult;
              spouse: McResult | null;
            };
            mcClient = {
              status: r.client.status,
              faceValue: r.client.faceValue,
              achievedScore: r.client.achievedScore,
            };
            mcSpouse = r.spouse
              ? {
                  status: r.spouse.status,
                  faceValue: r.spouse.faceValue,
                  achievedScore: r.spouse.achievedScore,
                }
              : null;
          } else if (event === "error") {
            throw new Error(
              (JSON.parse(data) as { message: string }).message,
            );
          }
        },
      );

      if (!mcClient) throw new Error("Monte Carlo solve returned no result");

      return {
        curveRows,
        mcClient,
        mcSpouse,
        assumptions: {
          deathYear: assumptions.deathYear,
          modelPortfolioLabel,
          mcTargetScore: assumptions.mcTargetScore,
        },
      };
    },
    [clientId],
  );

  return { solveScenario, progress, cancel, setProgress };
}
