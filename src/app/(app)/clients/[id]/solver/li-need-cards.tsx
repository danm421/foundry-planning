"use client";

// Life Insurance solver — need-result cards (Task 11 / Task 16).
//
// Two KPI cards summarizing the straight-line solve: how much *additional*
// life insurance each spouse needs if they die in `deathYear`, the existing
// coverage already in force (per-policy breakdown), and the total recommended
// coverage. When the plan is single only the client card renders. A case
// whose solve hit the cap ("exceeds-cap") shows a cap label for the need and
// omits the total.
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { roundUpTo50k } from "@/lib/life-insurance/round";
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
  // Display rounding: bump the need up to the nearest $50k, add the (exact,
  // unrounded) existing coverage, then round the sum again.
  const need = roundUpTo50k(solveCase.faceValue);
  const totalRecommended = roundUpTo50k(need + solveCase.existingCoverageTotal);

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
        {exceedsCap ? CAP_LABEL : formatCurrency(need)}
      </div>
      <div className="mt-1.5 text-[11px] text-ink-3">
        {exceedsCap
          ? "Need exceeds the solver's coverage cap"
          : "Additional life insurance needed"}
      </div>

      <div className="mt-3 border-t border-hair pt-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-ink-3">Existing coverage in force</span>
          <span className="tabular text-ink-2">
            {formatCurrency(solveCase.existingCoverageTotal)}
          </span>
        </div>
        {solveCase.existingPolicies.length === 0 ? (
          <p className="mt-1 text-[11px] text-ink-4">None in force in {deathYear}.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {solveCase.existingPolicies.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex items-center justify-between text-[11px] text-ink-3"
              >
                <span>{p.name}</span>
                <span className="tabular">{formatCurrency(p.faceValue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!exceedsCap ? (
        <div className="mt-2.5 flex items-center justify-between border-t border-hair pt-2.5 text-[12px]">
          <span className="font-medium text-ink-2">Total recommended coverage</span>
          <span className="tabular font-semibold text-ink">
            {formatCurrency(totalRecommended)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
