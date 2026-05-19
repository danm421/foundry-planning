"use client";

// Life Insurance solver — need-result cards (Task 11).
//
// Two KPI cards summarizing the straight-line solve: how much life insurance
// each spouse needs if they die in `deathYear`. When the plan is single only
// the client card renders. A case whose solve hit the cap ("exceeds-cap")
// shows a cap label instead of a face-value number.
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import type { LiSolveCase, LiSolveResult } from "./solver-tab-life-insurance";

// Mirrors the solver's straight-line cap (see `solve-need.ts`). Kept as a
// display constant — the engine is the source of truth for the actual bound.
const CAP_LABEL = "exceeds $20M";

interface Props {
  result: LiSolveResult;
  deathYear: number;
  clientName: string;
  spouseName: string;
}

export function LiNeedCards({ result, deathYear, clientName, spouseName }: Props) {
  return (
    <div
      className={`grid gap-3 ${result.isMarried ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}
    >
      <NeedCard name={clientName} deathYear={deathYear} solveCase={result.client} />
      {result.isMarried && result.spouse ? (
        <NeedCard name={spouseName} deathYear={deathYear} solveCase={result.spouse} />
      ) : null}
    </div>
  );
}

function NeedCard({
  name,
  deathYear,
  solveCase,
}: {
  name: string;
  deathYear: number;
  solveCase: LiSolveCase;
}) {
  const exceedsCap = solveCase.status === "exceeds-cap";

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        If {name} dies in {deathYear}
      </div>
      <div
        className={`mt-1.5 text-[22px] font-semibold leading-none tabular tracking-tight ${
          exceedsCap ? "text-warn" : "text-ink"
        }`}
      >
        {exceedsCap ? CAP_LABEL : formatCurrency(solveCase.faceValue)}
      </div>
      <div className="mt-1.5 text-[11px] text-ink-3">
        {exceedsCap
          ? "Need exceeds the solver's coverage cap"
          : "Life insurance needed"}
      </div>
    </div>
  );
}
