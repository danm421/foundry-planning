"use client";

// Life Insurance solver — need-over-time section (Task 17).
//
// A collapsible panel at the bottom of the LI tab. On "Run need over time" it
// opens a POST fetch-stream to the over-time SSE route — which runs one
// straight-line bisection solve per plan year per decedent — drives a progress
// bar from the streamed `progress` events, and on the terminal `result` event
// renders a two-series Chart.js line chart (life-insurance need by death year,
// client vs spouse) plus a table of the rows.
//
// The computation is expensive, so it never auto-runs — only the explicit
// button click triggers it. SSE-fetch + event-parsing mirrors `li-mc-solve.tsx`;
// the chart chrome mirrors `li-survivor-chart.tsx`.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

/** Streamed `progress` SSE payload from the over-time route. */
interface OverTimeProgressPayload {
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
  /** Full current assumptions — POSTed verbatim as the over-time body. */
  assumptions: LiAssumptions;
  /** Whether the plan is married — drives the spouse series + column. */
  isMarried: boolean;
  clientName: string;
  spouseName: string;
}

export function LiOverTimeSection({
  clientId,
  assumptions,
  isMarried,
  clientName,
  spouseName,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OverTimeProgressPayload | null>(null);
  const [rows, setRows] = useState<NeedOverTimeRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Abort any in-flight run when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Collapsing the panel unmounts the streaming subtree (and the Cancel
  // button), so abort the run when toggling from open to closed.
  const handleToggle = useCallback(() => {
    setIsOpen((open) => {
      if (open) abortRef.current?.abort();
      return !open;
    });
  }, []);

  const handleRun = useCallback(async () => {
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
      res = await fetch(`/api/clients/${clientId}/life-insurance/over-time`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assumptions),
        signal: ac.signal,
      });
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
            setProgress(JSON.parse(ev.data) as OverTimeProgressPayload);
          } else if (ev.event === "result") {
            const parsed = JSON.parse(ev.data) as { rows: NeedOverTimeRow[] };
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
  }, [clientId, assumptions]);

  return (
    <div className="rounded-lg border border-hair bg-card">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="text-[13px] font-medium text-ink">
            Need over time
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Life insurance need by year of death, across the whole plan.
          </p>
        </div>
        <span
          aria-hidden
          className={`text-ink-3 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-hair px-4 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={isRunning}
              className="h-9 rounded-md bg-accent px-3.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run need over time
            </button>
            {isRunning ? (
              <button
                type="button"
                onClick={handleCancel}
                className="h-9 rounded-md border border-hair-2 px-3 text-[12px] text-ink-2 hover:bg-card-2"
              >
                Cancel
              </button>
            ) : null}
          </div>

          {isRunning ? <OverTimeProgressBar progress={progress} /> : null}

          {errorMessage ? (
            <div
              role="alert"
              className="mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
            >
              {errorMessage}
            </div>
          ) : null}

          {rows && !isRunning ? (
            <OverTimeResult
              rows={rows}
              isMarried={isMarried}
              clientName={clientName}
              spouseName={spouseName}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Progress bar driven by the route's per-year `done/total` count. */
function OverTimeProgressBar({
  progress,
}: {
  progress: OverTimeProgressPayload | null;
}) {
  let pct = 0;
  let label = "Starting need-over-time solve…";
  if (progress && progress.total > 0) {
    pct = Math.min(100, (progress.done / progress.total) * 100);
    label = `Solving year ${progress.done} of ${progress.total}…`;
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

function OverTimeResult({
  rows,
  isMarried,
  clientName,
  spouseName,
}: {
  rows: NeedOverTimeRow[];
  isMarried: boolean;
  clientName: string;
  spouseName: string;
}) {
  const labels = rows.map((r) => String(r.year));

  const datasets = [
    {
      label: `${clientName} dies`,
      data: rows.map((r) => r.clientNeed),
      borderColor: "#2563eb",
      backgroundColor: "#2563eb",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
    },
  ];
  if (isMarried) {
    datasets.push({
      label: `${spouseName} dies`,
      data: rows.map((r) => r.spouseNeed ?? 0),
      borderColor: "#d97706",
      backgroundColor: "#d97706",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
    });
  }

  const chartData = { labels, datasets };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: { color: "#d1d5db", boxWidth: 12, padding: 16 },
      },
      tooltip: {
        backgroundColor: "#1f2937",
        titleColor: "#f3f4f6",
        bodyColor: "#d1d5db",
        callbacks: {
          label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
            `${ctx.dataset.label}: ${formatCurrency(Number(ctx.raw))}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#9ca3af" },
        grid: { color: "#374151" },
      },
      y: {
        ticks: {
          color: "#9ca3af",
          callback: (value: unknown) => formatCurrency(Number(value)),
        },
        grid: { color: "#374151" },
      },
    },
  };

  return (
    <div className="mt-4">
      <div className="text-[11px] text-ink-3">
        Life insurance need by year of death.
      </div>
      <div className="mt-2" style={{ height: 300 }}>
        <Line data={chartData} options={chartOptions} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-hair">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-hair text-ink-3">
              <th className="px-3 py-2 text-left font-medium">Year</th>
              <th className="px-3 py-2 text-right font-medium">
                If {clientName} dies
              </th>
              {isMarried ? (
                <th className="px-3 py-2 text-right font-medium">
                  If {spouseName} dies
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-b border-hair last:border-0">
                <td className="px-3 py-1.5 text-left tabular text-ink-2">
                  {r.year}
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink">
                  <NeedCell value={r.clientNeed} status={r.clientStatus} />
                </td>
                {isMarried ? (
                  <td className="px-3 py-1.5 text-right tabular text-ink">
                    {r.spouseNeed != null ? (
                      <NeedCell
                        value={r.spouseNeed}
                        status={r.spouseStatus ?? "solved"}
                      />
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A single need value — shows a cap label when the year's solve exceeded the cap. */
function NeedCell({
  value,
  status,
}: {
  value: number;
  status: NeedOverTimeRow["clientStatus"];
}) {
  if (status === "exceeds-cap") {
    return <span className="text-warn">exceeds cap</span>;
  }
  return <span>{formatCurrency(value)}</span>;
}
