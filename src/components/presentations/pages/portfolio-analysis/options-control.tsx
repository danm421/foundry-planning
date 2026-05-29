"use client";
import type { PortfolioAnalysisOptions } from "@/lib/presentations/pages/portfolio-analysis/options-schema";
import { useInvestmentOptionCatalog } from "@/components/presentations/options-context";

const TYPE_LABEL: Record<string, string> = {
  asset_class: "Asset Classes", account: "Accounts", category: "Account Categories",
  custom_group: "Custom Groups", model_portfolio: "Model Portfolios",
};
const TYPE_ORDER = ["asset_class", "category", "model_portfolio", "custom_group", "account"];
const SORTS: { key: PortfolioAnalysisOptions["sortKey"]; label: string }[] = [
  { key: "name", label: "Name" }, { key: "return", label: "Return" }, { key: "mean", label: "Mean" },
  { key: "stdDev", label: "σ" }, { key: "sharpe", label: "Sharpe" }, { key: "value", label: "Value" },
];

export function PortfolioAnalysisOptionsControl({ value, onChange }: { value: PortfolioAnalysisOptions; onChange: (next: PortfolioAnalysisOptions) => void }) {
  const { entities } = useInvestmentOptionCatalog();
  const selected = new Set(value.selectedKeys);
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange({ ...value, selectedKeys: [...next] });
  };
  const byType = TYPE_ORDER
    .map((t) => ({ type: t, items: entities.filter((e) => e.type === t) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3 text-sm text-ink-2">
      <div className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
        Entities {value.selectedKeys.length === 0 && "(default selection)"}
      </div>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {byType.map((g) => (
          <div key={g.type}>
            <div className="text-[10px] uppercase tracking-wide text-ink-3">{TYPE_LABEL[g.type] ?? g.type}</div>
            {g.items.map((e) => (
              <label key={e.key} className="flex items-center gap-2 hover:text-ink">
                <input type="checkbox" className="accent-accent" checked={selected.has(e.key)} onChange={() => toggle(e.key)} />
                <span>{e.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Sort by</span>
        <select className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
          value={value.sortKey} onChange={(e) => onChange({ ...value, sortKey: e.target.value as PortfolioAnalysisOptions["sortKey"] })}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 hover:text-ink">
        <input type="checkbox" className="accent-accent" checked={value.sortDir === "desc"} onChange={(e) => onChange({ ...value, sortDir: e.target.checked ? "desc" : "asc" })} />
        <span>Descending</span>
      </label>
    </div>
  );
}
