import type { ReactElement } from "react";

interface SectionMarkerProps {
  num: string;
  label: string;
  className?: string;
}

export default function SectionMarker({
  num,
  label,
  className,
}: SectionMarkerProps): ReactElement {
  const classes = [
    "font-mono text-[10px] font-semibold uppercase tracking-[0.08em]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <span className="text-accent">§.{num}</span>
      <span className="text-ink-4"> · {label.toUpperCase()}</span>
    </span>
  );
}
