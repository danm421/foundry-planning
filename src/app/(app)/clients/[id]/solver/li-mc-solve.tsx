"use client";

// Life Insurance solver — Monte Carlo solve block (Task 14).
//
// On-demand companion to the straight-line need cards. The advisor sets a
// probability-of-success target and clicks "Solve for score"; this opens a
// POST fetch-stream to the solve-mc SSE route, drives a progress bar from the
// streamed `progress` events, and renders the two solved face values from the
// terminal `result` event.
//
// MC is expensive (250 trials × ~24 bisection iterations × up to 2 decedents)
// so it never auto-runs — only the explicit button click triggers it. The
// target-score input lifts `mcTargetScore` to the parent so the existing
// settings autosave persists it; that may also trip the parent's cheap
// debounced straight-line solve, which is fine.
import { useCallback, useRef, useState } from "react";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

/** One decedent's MC solve outcome (mirrors `NeedMcResult` in solve-need-mc.ts). */
interface NeedMcResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedScore: number;
  iterations: number;
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

// Mirrors the MC solver's coverage cap (see solve-need-mc.ts). Display-only —
// the engine is the source of truth for the actual bound.
const CAP_LABEL = "exceeds $20M";

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
  /** Full current assumptions — POSTed verbatim as the solve-mc body. */
  assumptions: LiAssumptions;
  clientName: string;
  spouseName: string;
  /** Lift the updated `mcTargetScore` (decimal 0–1) to the parent. */
  onScoreChange(score: number): void;
}

export function LiMcSolve({
  clientId,
  assumptions,
  clientName,
  spouseName,
  onScoreChange,
}: Props) {
  const [isSolving, setIsSolving] = useState(false);
  const [progress, setProgress] = useState<McProgressPayload | null>(null);
  const [result, setResult] = useState<McResultPayload | null>(null);
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
    setResult(null);
    setErrorMessage(null);

    let res: Response;
    try {
      res = await fetch(`/api/clients/${clientId}/life-insurance/solve-mc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assumptions),
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
  }, [clientId, assumptions]);

  const targetPct = Math.round(assumptions.mcTargetScore * 1000) / 10;

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="text-[13px] font-medium text-ink">
        Monte Carlo need
      </div>
      <p className="mt-0.5 text-[11px] text-ink-3">
        Solve for the face value that hits a target probability of success.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label
            className="block text-[11px] text-ink-3"
            htmlFor="li-mc-target-score"
          >
            Target success score
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
            className="h-9 rounded-md bg-accent px-3.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>

      {isSolving ? <McProgressBar progress={progress} clientName={clientName} spouseName={spouseName} /> : null}

      {errorMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {result && !isSolving ? (
        <div
          className={`mt-3 grid gap-3 ${
            result.isMarried ? "sm:grid-cols-2" : "sm:grid-cols-1"
          }`}
        >
          <McResultCard name={clientName} mcCase={result.client} />
          {result.isMarried && result.spouse ? (
            <McResultCard name={spouseName} mcCase={result.spouse} />
          ) : null}
        </div>
      ) : null}
    </div>
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
      className="mt-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
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

function McResultCard({ name, mcCase }: { name: string; mcCase: NeedMcResult }) {
  const exceedsCap = mcCase.status === "exceeds-cap";
  const scorePct = Math.round(mcCase.achievedScore * 1000) / 10;

  return (
    <div className="rounded-lg border border-hair bg-card-2 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        If {name} dies
      </div>
      <div
        className={`mt-1.5 text-[22px] font-semibold leading-none tabular tracking-tight ${
          exceedsCap ? "text-warn" : "text-ink"
        }`}
      >
        {exceedsCap ? CAP_LABEL : formatCurrency(mcCase.faceValue)}
      </div>
      <div className="mt-1.5 text-[11px] text-ink-3">
        {exceedsCap
          ? "Need exceeds the solver's coverage cap"
          : `Monte Carlo coverage — ${scorePct}% success`}
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
