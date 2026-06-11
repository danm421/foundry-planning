"use client";

import MoneyText from "@/components/money-text";

export interface RebalanceSourceProps {
  accounts: { id: string; name: string; category: string; value: number }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function RebalanceSource({ accounts, selectedIds, onChange }: RebalanceSourceProps) {
  const selected = new Set(selectedIds);
  const total = accounts.filter((a) => selected.has(a.id)).reduce((s, a) => s + a.value, 0);
  const toggle = (id: string) =>
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-ink">Source accounts</h3>
      {accounts.length === 0 && (
        <p className="text-sm text-ink-3">No accounts have holdings yet.</p>
      )}
      <ul className="divide-y divide-hair-2">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
                className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              {a.name}
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-4">
                {a.category}
              </span>
            </label>
            <MoneyText value={a.value} />
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t border-hair-2 pt-2 text-sm">
        <span className="text-ink-3">Selected total</span>
        <MoneyText value={total} />
      </div>
    </section>
  );
}
