"use client";

// src/components/scenario/net-delta-summary.tsx
//
// Compare-panel header that shows the net signed delta in the headline metric
// (typically end-of-plan portfolio) for the current toggle selection plus a
// minimal hand-rolled SVG sparkline. Lives at the top of <ChangesPanel>.

export interface NetDeltaSummaryProps {
  /** Signed delta in dollars. */
  delta: number;
  /** Lowercase descriptor, e.g. "end-of-plan portfolio". */
  metricLabel: string;
  /**
   * Optional time-series data feeding the sparkline. When length < 2 the
   * sparkline is suppressed (a single point isn't useful).
   */
  sparklineData?: number[];
}

export function NetDeltaSummary({
  delta,
  metricLabel,
  sparklineData = [],
}: NetDeltaSummaryProps) {
  const positive = delta >= 0;
  const sign = positive ? "+" : "−";
  const abs = formatCurrencyShort(Math.abs(delta));
  return (
    <div
      data-testid="net-delta-summary"
      className="px-4 py-3 border-b border-[#1f2024]"
    >
      <div className="text-xs tracking-[0.18em] uppercase font-mono text-[#7a5b29] mb-2">
        NET DELTA
      </div>
      <div
        className={`font-mono text-[32px] tabular-nums ${
          positive ? "text-[#7fa97f]" : "text-[#c87a7a]"
        }`}
        data-testid="net-delta-value"
      >
        {sign}${abs}
      </div>
      <div className="text-xs text-[#a09c92]">{metricLabel}</div>
      {sparklineData.length > 1 && (
        <Sparkline data={sparklineData} positive={positive} />
      )}
    </div>
  );
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const w = 200;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      className="mt-2"
      aria-hidden="true"
      data-testid="net-delta-sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#7fa97f" : "#c87a7a"}
        strokeWidth="1"
      />
    </svg>
  );
}

function formatCurrencyShort(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return n.toFixed(0);
}
