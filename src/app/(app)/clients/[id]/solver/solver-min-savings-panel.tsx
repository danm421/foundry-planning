"use client";

import { useState, type ReactNode } from "react";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { SolverSolveProgressStrip } from "./solver-solve-progress-strip";

export interface MinSavingsResult {
  status: "converged" | "unreachable" | "max-iterations";
  savings: number;
  portfolioName: string;
  startYear: number;
  endYear: number;
  targetPoS: number;
  baselineLiving: number;
  updatedLiving: number;
  fromCashFlow: number;
  fromExpenseReduction: number;
}

interface Props {
  portfolios: SolverModelPortfolio[];
  disabled: boolean;
  phase: "idle" | "solving" | "result";
  progress: { iteration: number; candidateValue: number | null; achievedPoS: number | null; targetPoS: number } | null;
  result: MinSavingsResult | null;
  onSolve: (modelPortfolioId: string, targetPoS: number) => void;
  onIncludeSelfFunding: () => void;
  onIncludeLockInCut: () => void;
  onDismissResult: () => void;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function SolverMinSavingsPanel({
  portfolios, disabled, phase, progress, result,
  onSolve, onIncludeSelfFunding, onIncludeLockInCut, onDismissResult,
}: Props) {
  const [configuring, setConfiguring] = useState(false);
  const [portfolioId, setPortfolioId] = useState<string>(portfolios[0]?.id ?? "");
  const [targetPct, setTargetPct] = useState<number>(85);

  if (phase === "solving") {
    return (
      <div className="mt-2">
        <SolverSolveProgressStrip
          title={`Solving minimum additional savings for ${Math.round((progress?.targetPoS ?? 0.85) * 100)}% PoS`}
          iteration={progress?.iteration ?? 0}
          maxIterations={8}
          candidateValue={progress?.candidateValue ?? null}
          achievedPoS={progress?.achievedPoS ?? null}
          valueFormatter={money}
          onCancel={onDismissResult}
        />
      </div>
    );
  }

  if (phase === "result" && result) {
    const reduced = result.fromExpenseReduction > 0;
    return (
      <div className="mt-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-3 text-[13px]">
        {result.status === "unreachable" ? (
          <p className="text-warn">
            Couldn&apos;t reach {Math.round(result.targetPoS * 100)}% success even at {money(result.savings)}/yr — this is the most it reaches.
          </p>
        ) : (
          <p className="text-ink">
            Save an additional <span className="font-semibold tabular">{money(result.savings)}/yr</span>{" "}
            ({result.startYear}–{result.endYear}) in {result.portfolioName} to reach{" "}
            {Math.round(result.targetPoS * 100)}% success.
          </p>
        )}
        <p className="mt-2 text-ink-2">
          Living expenses this year{" "}
          <span className="tabular">{money(result.baselineLiving)}</span> →{" "}
          <span className="font-semibold tabular text-ink">{money(result.updatedLiving)}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {reduced
            ? `${money(result.fromExpenseReduction)} from cutting spending; ${money(result.fromCashFlow)} from existing cash flow`
            : `fully funded by existing cash flow`}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <ActionTip text="Keep funding the plan from the modeled spending cut. The amount is added as an editable contribution above so you can fine-tune it; the client's stated living expenses are left unchanged.">
            <button
              type="button"
              onClick={onIncludeSelfFunding}
              className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-accent-on hover:bg-accent/90"
            >
              Keep self-funding
            </button>
          </ActionTip>
          <ActionTip text="Bake the cut in permanently: lower the client's working-years living expenses by this amount and turn the freed-up cash into a regular savings contribution.">
            <button
              type="button"
              onClick={onIncludeLockInCut}
              className="h-7 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[12px] text-ink-2 hover:border-hair"
            >
              Lock in cut
            </button>
          </ActionTip>
          <ActionTip
            text="Discard this result and return the projection to its pre-solve state. Nothing is saved."
            align="right"
            className="ml-auto"
          >
            <button
              type="button"
              onClick={onDismissResult}
              className="text-[12px] text-ink-3 hover:text-ink-2"
            >
              Dismiss
            </button>
          </ActionTip>
        </div>
      </div>
    );
  }

  if (configuring) {
    const canSolve = portfolioId !== "" && targetPct >= 1 && targetPct <= 99;
    return (
      <div className="mt-2 rounded-md border border-hair-2 bg-card-2 p-3">
        <div className="text-[12px] font-medium text-ink">Solve minimum additional savings</div>
        <label className="mt-2 block text-[11px] text-ink-3" htmlFor="ms-portfolio">
          Invest savings in
        </label>
        <select
          id="ms-portfolio"
          aria-label="Invest savings in"
          value={portfolioId}
          onChange={(e) => setPortfolioId(e.target.value)}
          className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-[13px] text-ink"
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label className="mt-2 block text-[11px] text-ink-3" htmlFor="ms-target">
          Target success
        </label>
        <div className="mt-1 flex items-center gap-1">
          <input
            id="ms-target"
            type="number"
            min={1}
            max={99}
            value={targetPct}
            aria-label="Target success"
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isNaN(n)) return;
              setTargetPct(Math.min(99, Math.max(1, n)));
            }}
            className="h-8 w-20 rounded-md border border-hair-2 bg-card px-2 text-[14px] text-ink tabular focus:outline-none focus:border-accent"
          />
          <span className="text-[12px] text-ink-3">%</span>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfiguring(false)}
            className="h-7 rounded-md border border-hair-2 bg-card px-2.5 text-[12px] text-ink-2 hover:border-hair"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSolve}
            onClick={() => { setConfiguring(false); onSolve(portfolioId, targetPct / 100); }}
            className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Solve
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setPortfolioId(portfolios[0]?.id ?? "");
          setTargetPct(85);
          setConfiguring(true);
        }}
        disabled={disabled || portfolios.length === 0}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on disabled:cursor-not-allowed disabled:opacity-50"
      >
        Solve minimum additional savings
      </button>
    </div>
  );
}

/** Wraps an action button with a "what does this do" tooltip revealed on hover
 *  and keyboard focus. `align` keeps the floating copy inside the card edge:
 *  left-anchored by default, right-anchored for the trailing Dismiss button. */
function ActionTip({
  text,
  align = "left",
  className,
  children,
}: {
  text: string;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`group relative inline-flex ${className ?? ""}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute bottom-full ${
          align === "right" ? "right-0" : "left-0"
        } z-50 mb-2 w-60 max-w-[calc(100vw-2rem)] rounded-md border border-hair bg-card px-3 py-2 text-[11px] leading-snug text-ink-2 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100`}
      >
        {text}
      </span>
    </span>
  );
}
