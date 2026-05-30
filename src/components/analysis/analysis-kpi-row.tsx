// Presentational KPI row component — a responsive grid of 1–4 metric cards.
// Values are pre-formatted strings; formatting lives in the copy modules.

export interface KpiItem {
  /** Pre-formatted value string, e.g. "$1.2M", "85/81", "63%". */
  value: string;
  /** Short label shown beneath the value. */
  label: string;
  /** Longer explanation shown in smaller text below the label. */
  explainer: string;
  /** "crit" colours the value in --color-crit (negatives, warnings). */
  tone?: "default" | "crit";
}

interface Props {
  items: KpiItem[];
}

export function AnalysisKpiRow({ items }: Props) {
  return (
    <div className="grid grid-cols-1 gap-[var(--gap-grid)] sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <span
            className={`tabular text-4xl font-semibold leading-none tracking-tight ${
              item.tone === "crit"
                ? "text-[color:var(--color-crit)]"
                : "text-ink"
            }`}
          >
            {item.value}
          </span>
          <span className="text-sm font-semibold text-ink-2">{item.label}</span>
          <p className="text-xs text-ink-4">{item.explainer}</p>
        </div>
      ))}
    </div>
  );
}
