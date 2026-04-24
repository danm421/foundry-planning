import type { ReactElement } from "react";

type Tone = "good" | "crit" | "neutral";

interface DeltaPillProps {
  delta: number | null;
  suffix?: string;
  tone?: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  good: "text-good bg-good/12",
  crit: "text-crit bg-crit/12",
  neutral: "text-ink-3 bg-card-2",
};

export default function DeltaPill({
  delta,
  suffix,
  tone,
}: DeltaPillProps): ReactElement | null {
  if (delta == null) return null;
  const inferredTone: Tone = tone ?? (delta > 0 ? "good" : delta < 0 ? "crit" : "neutral");
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  const magnitude = Math.abs(delta);
  const text = suffix ? `${arrow} ${magnitude}${suffix}` : `${arrow} ${magnitude}`;
  return (
    <span
      className={`tabular inline-flex items-center rounded-sm px-1.5 py-[2px] font-mono text-[11px] ${TONE_CLASS[inferredTone]}`}
    >
      {text}
    </span>
  );
}
