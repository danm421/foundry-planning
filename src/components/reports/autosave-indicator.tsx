// src/components/reports/autosave-indicator.tsx
//
// Tiny status pill rendered in the top bar. Task 9 wires it to a real
// autosave hook; for now it accepts a status prop directly.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function AutosaveIndicator({
  status,
  className = "",
}: {
  status: SaveStatus;
  className?: string;
}) {
  const dotColor =
    status === "saving"
      ? "bg-warn animate-pulse"
      : status === "error"
        ? "bg-crit"
        : "bg-good";
  const label =
    status === "saving"
      ? "SAVING"
      : status === "error"
        ? "ERROR · RETRY"
        : "SAVED · AUTO";
  return (
    <div
      className={`flex items-center gap-2 text-[11px] font-mono text-ink-3 ${className}`}
    >
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      {label}
    </div>
  );
}
