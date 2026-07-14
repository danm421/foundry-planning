"use client";

// Life Insurance solver — need range.
//
// Presents each decedent's additional-coverage need as a RANGE: the
// straight-line solve is the lower bound, the Monte Carlo solve the upper
// bound. The straight-line result arrives automatically from the parent
// (`solveResult`); the Monte Carlo result is on-demand — the advisor sets a
// target success score and clicks "Solve for score", which opens an SSE
// stream to the solve-mc route. MC is expensive (250 trials × ~24 bisection
// iterations × up to 2 decedents) so it never auto-runs.
//
// Renders a compact Monte Carlo control strip, then one range card per
// decedent — both above the assumptions panel.
import { useCallback, useRef, useState } from "react";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { roundUpTo50k } from "@/lib/life-insurance/round";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import type { LiSolveCase, LiSolveResult } from "./solver-tab-life-insurance";

// Mirrors the solvers' coverage cap (see solve-need.ts / solve-need-mc.ts).
// Display-only — the engine is the source of truth for the actual bound.
const CAP_LABEL = "exceeds $20M";

/** One decedent's MC solve outcome (mirrors `NeedMcResult` in solve-need-mc.ts). */
interface NeedMcResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedScore: number;
  iterations: number;
  /** Federal + state estate tax + IRD folded into the solve target; `0`
   *  when the "Cover estate taxes" toggle is off. */
  estateTaxAddend: number;
}

/** Terminal `result` SSE payload from the solve-mc route. */
interface McResultPayload {
  isMarried: boolean;
  client: NeedMcResult;
  spouse: NeedMcResult | null;
}

/** Streamed `progress` SSE payload. */
interface McProgressPayload {
  case: "client" | "spouse";
  done: number;
  total: number;
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

interface Props {
  clientId: string;
  /** Straight-line solve — the range's lower bound (owned by the tab). */
  solveResult: LiSolveResult;
  /** Full current assumptions — POSTed as the solve-mc body's `assumptions`. */
  assumptions: LiAssumptions;
  clientName: string;
  spouseName: string;
  /** Lift the updated `mcTargetScore` (decimal 0–1) to the parent. */
  onScoreChange(score: number): void;
  /** Live solver source + unsaved mutations, so the MC solve reflects the
   *  edited plan — not the base case. */
  source: SolverSource;
  mutations: SolverMutation[];
}

export function LiNeedRange({
  clientId,
  solveResult,
  assumptions,
  clientName,
  spouseName,
  onScoreChange,
  source,
  mutations,
}: Props) {
  const [isSolving, setIsSolving] = useState(false);
  const [progress, setProgress] = useState<McProgressPayload | null>(null);
  const [mcResult, setMcResult] = useState<McResultPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSolve = useCallback(async () => {
    // Tear down any prior run before starting a fresh one.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setIsSolving(true);
    setProgress(null);
    setMcResult(null);
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
            setMcResult(JSON.parse(ev.data) as McResultPayload);
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

  const targetPct = Math.round(assumptions.mcTargetScore * 1000) / 10;
  const deathYear = assumptions.deathYear;

  return (
    <div className="space-y-3">
      {/* Monte Carlo control strip — straight-line auto-solves; MC is on-demand. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border border-hair bg-card px-4 py-3">
        <div>
          <label
            className="block text-[11px] text-ink-3"
            htmlFor="li-mc-target-score"
          >
            Monte Carlo target success
          </label>
          <div className="relative mt-1">
            <TargetScoreInput
              id="li-mc-target-score"
              targetPct={targetPct}
              disabled={isSolving}
              onCommit={onScoreChange}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
              %
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSolve()}
            disabled={isSolving}
            className="h-9 rounded-md bg-accent px-3.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Solve for score
          </button>
          {isSolving ? (
            <button
              type="button"
              onClick={handleCancel}
              className="h-9 rounded-md border border-hair-2 px-3 text-[12px] text-ink-2 hover:bg-card-2"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <p className="ml-auto max-w-[15rem] text-[11px] leading-snug text-ink-3">
          Straight-line sets the lower bound of the need range; Monte Carlo the
          upper bound.
        </p>
      </div>

      {isSolving ? (
        <McProgressBar
          progress={progress}
          clientName={clientName}
          spouseName={spouseName}
        />
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* One range card per decedent — all on one row. */}
      <div
        className={`grid gap-3 ${
          solveResult.isMarried ? "sm:grid-cols-2" : "sm:grid-cols-1"
        }`}
      >
        <RangeCard
          name={clientName}
          deathYear={deathYear}
          straightLine={solveResult.client}
          mc={mcResult?.client ?? null}
          showEstateTaxes={assumptions.coverEstateTaxes}
        />
        {solveResult.isMarried && solveResult.spouse ? (
          <RangeCard
            name={spouseName}
            deathYear={deathYear}
            straightLine={solveResult.spouse}
            mc={mcResult?.spouse ?? null}
            showEstateTaxes={assumptions.coverEstateTaxes}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * One decedent's need card. The headline is a range: the straight-line solved
 * need (lower bound) → the Monte Carlo solved need (upper bound). The upper
 * bound is a muted placeholder until the advisor runs the MC solve.
 */
function RangeCard({
  name,
  deathYear,
  straightLine,
  mc,
  showEstateTaxes,
}: {
  name: string;
  deathYear: number;
  straightLine: LiSolveCase;
  mc: NeedMcResult | null;
  showEstateTaxes: boolean;
}) {
  const slExceedsCap = straightLine.status === "exceeds-cap";
  const slNeed = roundUpTo50k(straightLine.faceValue);
  const existing = straightLine.existingCoverageTotal;

  const mcExceedsCap = mc?.status === "exceeds-cap";
  const mcNeed = mc ? roundUpTo50k(mc.faceValue) : null;
  const mcScorePct = mc ? Math.round(mc.achievedScore * 1000) / 10 : null;

  // Upper bound of the range — a muted placeholder until the MC solve runs.
  const upperValue = !mc
    ? "—"
    : mcExceedsCap
      ? CAP_LABEL
      : formatCurrency(mcNeed ?? 0);
  const upperLabel = mc ? `Monte Carlo · ${mcScorePct}%` : "Run Monte Carlo";

  // Total recommended = additional need + existing coverage already in force.
  // Becomes a range once the MC upper bound has been solved. Only rendered
  // when the straight-line solve is within cap (see the JSX guard below).
  const totalLow = roundUpTo50k(slNeed + existing);
  const totalDisplay =
    mc && !mcExceedsCap
      ? `${formatCurrency(totalLow)} – ${formatCurrency(
          roundUpTo50k((mcNeed ?? 0) + existing),
        )}`
      : formatCurrency(totalLow);

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        If {name} dies in {deathYear}
      </div>

      {/* The need range — straight-line (low) → Monte Carlo (high). */}
      <div className="mt-2 flex items-start gap-3">
        <RangeEnd
          label="Straight-line"
          value={slExceedsCap ? CAP_LABEL : formatCurrency(slNeed)}
          warn={slExceedsCap}
          hint={{
            ariaLabel: "What is the straight-line solve?",
            text: "Coverage that funds the survivor's plan using fixed average market returns — no volatility. The lower bound of the need range.",
          }}
        />
        <svg
          viewBox="0 0 24 12"
          className="mt-1.5 h-3 w-6 shrink-0 text-ink-3"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1 6h21m0 0-5-4m5 4-5 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <RangeEnd
          label={upperLabel}
          value={upperValue}
          warn={mcExceedsCap}
          muted={!mc}
          hint={{
            ariaLabel: "What is the Monte Carlo solve?",
            text: "Coverage that hits your target probability of success across many randomized market trials. Volatility-aware — the upper bound of the range.",
          }}
        />
      </div>
      <div className="mt-2.5 text-[11px] text-ink-2">
        Additional life insurance needed
      </div>

      <div className="mt-3 border-t border-hair pt-2.5">
        {showEstateTaxes ? (
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 text-ink-2">
              Estate taxes
              <HelpHint
                ariaLabel="What do estate taxes include?"
                text="Federal + state estate tax plus income tax on IRD (retirement accounts inherited as income in respect of a decedent), summed across both deaths. Added to the coverage target."
              />
            </span>
            {/* Same addend lives on `mc.estateTaxAddend`; reading from `straightLine` because
             *  it is always populated (the MC solve may still be running). */}
            <span className="tabular text-ink-2">
              {formatCurrency(straightLine.estateTaxAddend)}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-ink-2">Existing coverage in force</span>
          <span className="tabular text-ink-2">{formatCurrency(existing)}</span>
        </div>
        {straightLine.existingPolicies.length === 0 ? (
          <p className="mt-1 text-[11px] text-ink-3">
            None in force in {deathYear}.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {straightLine.existingPolicies.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex items-center justify-between text-[11px] text-ink-2"
              >
                <span>{p.name}</span>
                <span className="tabular">{formatCurrency(p.faceValue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!slExceedsCap ? (
        <div className="mt-2.5 flex items-center justify-between border-t border-hair pt-2.5 text-[12px]">
          <span className="font-medium text-ink-2">
            Total recommended coverage
          </span>
          <span className="tabular font-semibold text-ink">{totalDisplay}</span>
        </div>
      ) : null}
    </div>
  );
}

/** One end of the range — a big tabular figure with a small caption beneath. */
function RangeEnd({
  label,
  value,
  warn,
  muted,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  muted?: boolean;
  hint?: { ariaLabel: string; text: string };
}) {
  return (
    <div>
      <div
        className={`text-[22px] font-semibold leading-none tabular tracking-tight ${
          warn ? "text-warn" : muted ? "text-ink-3" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        <span>{label}</span>
        {hint ? <HelpHint ariaLabel={hint.ariaLabel} text={hint.text} /> : null}
      </div>
    </div>
  );
}

/**
 * A small "?" affordance beside a label — reveals supporting detail on hover
 * or keyboard focus. Tooltip is `pointer-events-none` so it never blocks the
 * controls it overlaps.
 */
function HelpHint({ ariaLabel, text }: { ariaLabel: string; text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-hair-2 text-[10px] font-semibold leading-none text-ink-3 transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-52 -translate-x-1/2 rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/**
 * Progress bar. The route reports `done/total` per decedent case in turn
 * (client, then spouse). For a married plan that's two sequential passes — we
 * combine them into one 0–100% bar: the client case occupies the first half,
 * the spouse case the second half. For a single plan only the client case
 * fires, so its fraction maps straight to 0–100%.
 */
function McProgressBar({
  progress,
  clientName,
  spouseName,
}: {
  progress: McProgressPayload | null;
  clientName: string;
  spouseName: string;
}) {
  let pct = 0;
  let label = "Starting Monte Carlo solve…";
  if (progress && progress.total > 0) {
    const frac = Math.min(1, progress.done / progress.total);
    if (progress.case === "client") {
      // First half of the bar when a spouse pass may follow; harmless if not.
      pct = frac * 50;
      label = `Solving ${clientName} death…`;
    } else {
      pct = 50 + frac * 50;
      label = `Solving ${spouseName} death…`;
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{label}</span>
        <span className="text-[11px] tabular text-ink-3">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-hair-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Percent input — the advisor types a whole/decimal percent (`90`, `92.5`) and
 * the value is committed as the decimal `mcTargetScore` (`0.90`). The schema
 * bounds it to 0.01–0.99.
 */
function TargetScoreInput({
  id,
  targetPct,
  disabled,
  onCommit,
}: {
  id: string;
  targetPct: number;
  disabled?: boolean;
  onCommit: (decimal: number) => void;
}) {
  const [display, setDisplay] = useState<string>(String(targetPct));

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d.]/g, "");
    setDisplay(raw);
    if (raw === "" || raw === ".") return;
    const pct = Number(raw);
    if (Number.isNaN(pct)) return;
    const next = pct / 100;
    if (next < 0.01 || next > 0.99) return;
    onCommit(next);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      disabled={disabled}
      className="h-9 w-24 rounded-md border border-hair-2 bg-card-2 pl-2.5 pr-6 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Target success score"
    />
  );
}
