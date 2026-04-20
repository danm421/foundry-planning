const RADIUS = 50;
const STROKE_WIDTH = 8;
const WIDTH = 2 * (RADIUS + STROKE_WIDTH);
const HEIGHT = RADIUS + STROKE_WIDTH * 2;
const CX = WIDTH / 2;
const CY = RADIUS + STROKE_WIDTH;
const ARC_LENGTH = Math.PI * RADIUS; // circumference of a half-circle

// SVG path for a 180° arc from (CX - RADIUS, CY) to (CX + RADIUS, CY).
// Using the A (elliptical arc) command: rx ry x-axis-rotation large-arc-flag sweep-flag x y
const ARC_PATH = `M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY}`;

interface SuccessGaugeProps {
  value: number; // 0..1
}

export function SuccessGauge({ value }: SuccessGaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = ARC_LENGTH * clamped;
  const remaining = ARC_LENGTH - filled;

  return (
    <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <defs>
          <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(251, 113, 133)" />
            <stop offset="50%" stopColor="rgb(251, 191, 36)" />
            <stop offset="100%" stopColor="rgb(52, 211, 153)" />
          </linearGradient>
        </defs>
        {/* Track */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke="rgb(30, 41, 59)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          data-testid="gauge-fill"
          d={ARC_PATH}
          fill="none"
          stroke="url(#gauge-gradient)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${remaining}`}
        />
      </svg>
      <div
        data-testid="gauge-label"
        className="absolute inset-x-0 flex justify-center text-lg font-semibold text-slate-100 tabular-nums"
        style={{ top: CY - 14 }}
      >
        {Math.round(clamped * 100)}%
      </div>
    </div>
  );
}
