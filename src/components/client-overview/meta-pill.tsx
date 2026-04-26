import type { ReactElement } from "react";

interface MetaPillProps {
  label: string;
  active?: boolean;
}

export default function MetaPill({ label, active = false }: MetaPillProps): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-hair bg-card-2 px-2 py-[3px] font-mono text-xs text-ink-3">
      {active && (
        <span
          aria-hidden
          className="inline-block h-[6px] w-[6px] rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]"
        />
      )}
      {label}
    </span>
  );
}
