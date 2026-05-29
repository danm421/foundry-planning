// src/components/forms/holding-override-editor.tsx
"use client";

import { useMemo, useState } from "react";
import type { AssetClassOption } from "./asset-mix-tab";
import type { HoldingRow } from "@/lib/investments/holdings-client";

interface Props {
  holding: HoldingRow;
  assetClasses: AssetClassOption[];
  /** Persist the override (empty array clears → derived blend). Resolves when saved. */
  onSave: (overrides: { assetClassId: string; weight: number }[]) => Promise<void>;
  onClose: () => void;
}

export function HoldingOverrideEditor({ holding, assetClasses, onSave, onClose }: Props) {
  const initial = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of holding.overrides) m.set(o.assetClassId, o.weight);
    return m;
  }, [holding.overrides]);

  const [weights, setWeights] = useState<Map<string, number>>(initial);
  const [saving, setSaving] = useState(false);
  const [hideZero, setHideZero] = useState(true);

  const total = [...weights.values()].reduce((s, w) => s + w, 0);
  const over = total > 1.0001;

  // Derived-blend hint (slug → firm class name) shown when no override is set yet.
  const derivedHint = holding.overrides.length === 0
    ? holding.securityWeights
        .map((w) => {
          const ac = assetClasses.find((c) => c.slug === w.slug);
          return ac ? `${ac.name} ${(w.weight * 100).toFixed(0)}%` : null;
        })
        .filter(Boolean)
        .join(" · ")
    : "";

  function setWeight(assetClassId: string, raw: string) {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const v = cleaned === "" ? 0 : parseFloat(cleaned) / 100;
    if (isNaN(v) || v < 0 || v > 1) return;
    setWeights((prev) => {
      const next = new Map(prev);
      if (v === 0) next.delete(assetClassId);
      else next.set(assetClassId, v);
      return next;
    });
  }

  async function persist(payload: { assetClassId: string; weight: number }[]) {
    setSaving(true);
    try {
      await onSave(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const visible = hideZero
    ? assetClasses.filter((ac) => (weights.get(ac.id) ?? 0) > 0)
    : assetClasses;

  return (
    <div className="space-y-3 rounded-md border border-gray-700 bg-gray-900/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">
          Asset-class override — {holding.displayTicker ?? holding.displayName ?? "holding"}
        </span>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
          />
          Hide 0%
        </label>
      </div>

      {derivedHint && (
        <p className="text-xs text-gray-400">
          Currently derived: <span className="text-gray-300">{derivedHint}</span>. Setting an
          override replaces the derived blend for this holding permanently.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {visible.map((ac) => {
          const w = weights.get(ac.id) ?? 0;
          return (
            <div key={ac.id} className="flex items-center justify-between gap-2">
              <span className="flex-1 truncate text-sm text-gray-200">{ac.name}</span>
              <div className="flex w-20 shrink-0 items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={w > 0 ? (w * 100).toFixed(1) : ""}
                  placeholder="0"
                  onChange={(e) => setWeight(ac.id, e.target.value)}
                  className="h-7 w-full rounded-md border border-gray-600 bg-gray-800 px-2 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-sm text-gray-400">%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-gray-700 pt-2 text-sm">
        <span className={over ? "text-red-400" : "text-gray-300"}>
          Total {(total * 100).toFixed(1)}%
          {over ? " — exceeds 100%" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => persist([])}
            disabled={saving}
            className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Clear (use derived)
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => persist([...weights.entries()].map(([assetClassId, weight]) => ({ assetClassId, weight })))}
            disabled={saving || over}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save override"}
          </button>
        </div>
      </div>
    </div>
  );
}
