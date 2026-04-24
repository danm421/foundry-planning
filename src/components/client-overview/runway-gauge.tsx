import type { ReactElement } from "react";

interface RunwayGaugeProps {
  value: number | null; // 0..1
  width?: number;
  height?: number;
}

const RADIUS = 70;
const ARC_LENGTH = Math.PI * RADIUS;

function strokeVar(value: number | null): string {
  if (value == null) return "var(--color-hair)";
  if (value >= 0.75) return "var(--color-accent)";
  if (value >= 0.60) return "var(--color-warn)";
  return "var(--color-crit)";
}

export default function RunwayGauge({
  value,
  width = 180,
  height = 110,
}: RunwayGaugeProps): ReactElement {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value));
  const dash = ARC_LENGTH * pct;
  const centerText = value == null ? "—" : `${Math.round(value * 100)}%`;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 180 110"
      role="img"
      aria-label={value == null ? "Monte Carlo success not available" : `Monte Carlo success ${centerText}`}
    >
      {/* Track */}
      <path
        d="M 20 100 A 70 70 0 0 1 160 100"
        fill="none"
        stroke="var(--color-hair)"
        strokeWidth={10}
        strokeLinecap="round"
      />
      {/* Fill */}
      {value != null && (
        <path
          d="M 20 100 A 70 70 0 0 1 160 100"
          fill="none"
          stroke={strokeVar(value)}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${ARC_LENGTH}`}
        />
      )}
      {/* Center value */}
      <text
        x={90}
        y={78}
        textAnchor="middle"
        className="tabular"
        fill="var(--color-ink)"
        style={{ font: "500 28px var(--font-mono)", letterSpacing: "-0.03em" }}
      >
        {centerText}
      </text>
      {/* Label */}
      <text
        x={90}
        y={96}
        textAnchor="middle"
        fill="var(--color-ink-4)"
        style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.08em" }}
      >
        MC SUCCESS
      </text>
    </svg>
  );
}
