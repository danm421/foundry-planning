import type { ReactElement } from "react";

interface Props {
  values: number[];
  startYear?: number;
  height?: number;
  width?: number;
}

export default function NetWorthSparkline({
  values,
  startYear,
  height = 90,
  width = 340,
}: Props): ReactElement {
  if (values.length < 2) {
    return (
      <div className="flex h-[90px] items-end text-[11px] text-ink-4">
        Not enough data
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const step = width / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / span) * (height - 8) - 4,
  }));

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fillPath =
    `M ${points[0].x},${height} ` +
    points.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L ${points[points.length - 1].x},${height} Z`;

  const last = points[points.length - 1];

  const firstYear = startYear ?? new Date().getFullYear();
  const midYear = firstYear + Math.floor((values.length - 1) / 2);
  const lastYear = firstYear + values.length - 1;

  return (
    <svg width={width} height={height + 16} viewBox={`0 0 ${width} ${height + 16}`}>
      <defs>
        <linearGradient id="networth-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#networth-gradient)" />
      <polyline
        points={polyline}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* End-cap halo + dot */}
      <circle cx={last.x} cy={last.y} r="6" fill="var(--color-accent)" opacity="0.2" />
      <circle cx={last.x} cy={last.y} r="3" fill="var(--color-accent)" />
      {/* Year ticks */}
      <text
        x="0"
        y={height + 12}
        className="tabular"
        fill="var(--color-ink-4)"
        style={{ font: "500 10px var(--font-mono)" }}
      >
        {firstYear}
      </text>
      <text
        x={width / 2}
        y={height + 12}
        textAnchor="middle"
        className="tabular"
        fill="var(--color-ink-4)"
        style={{ font: "500 10px var(--font-mono)" }}
      >
        {midYear}
      </text>
      <text
        x={width}
        y={height + 12}
        textAnchor="end"
        className="tabular"
        fill="var(--color-ink-4)"
        style={{ font: "500 10px var(--font-mono)" }}
      >
        {lastYear}
      </text>
    </svg>
  );
}
