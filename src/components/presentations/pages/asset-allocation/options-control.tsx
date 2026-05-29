"use client";
import type { AssetAllocationOptions } from "@/lib/presentations/pages/asset-allocation/options-schema";
import { useInvestmentOptionCatalog } from "@/components/presentations/options-context";

const VIEWS: { key: AssetAllocationOptions["view"]; label: string }[] = [
  { key: "high_level", label: "By type" },
  { key: "detailed", label: "By class" },
  { key: "combined", label: "Combined" },
];

export function AssetAllocationOptionsControl({ value, onChange }: { value: AssetAllocationOptions; onChange: (next: AssetAllocationOptions) => void }) {
  const { groups } = useInvestmentOptionCatalog();
  return (
    <div className="space-y-3 text-sm text-ink-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Investment group</span>
        <select className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
          value={value.groupKey} onChange={(e) => onChange({ ...value, groupKey: e.target.value })}>
          {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Breakdown</legend>
        {VIEWS.map((v) => (
          <label key={v.key} className="flex items-center gap-2 hover:text-ink">
            <input type="radio" className="accent-accent" checked={value.view === v.key} onChange={() => onChange({ ...value, view: v.key })} />
            <span>{v.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 hover:text-ink">
        <input type="checkbox" className="accent-accent" checked={value.includeOutOfEstate} onChange={(e) => onChange({ ...value, includeOutOfEstate: e.target.checked })} />
        <span>Include out-of-estate accounts</span>
      </label>
      <label className="flex items-center gap-2 hover:text-ink">
        <input type="checkbox" className="accent-accent" checked={value.showTable} onChange={(e) => onChange({ ...value, showTable: e.target.checked })} />
        <span>Show allocation table</span>
      </label>
    </div>
  );
}
