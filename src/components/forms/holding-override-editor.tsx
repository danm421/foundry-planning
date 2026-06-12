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

/** Fraction (0–1) → percent text, trailing zeros dropped (0.11 → "11", 0.115 → "11.5"). */
function formatPercent(frac: number): string {
  return String(parseFloat((frac * 100).toFixed(4)));
}

/** Percent text → fraction (0–1). Blank or unparseable → 0. */
function parsePercent(raw: string | undefined): number {
  if (!raw) return 0;
  const v = parseFloat(raw) / 100;
  return isNaN(v) ? 0 : v;
}

export function HoldingOverrideEditor({ holding, assetClasses, onSave, onClose }: Props) {
  // Raw percent text the user typed, keyed by assetClassId. Stored verbatim while
  // typing so multi-digit entry (e.g. "100") isn't reformatted away on each keystroke.
  const initial = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of holding.overrides) m.set(o.assetClassId, formatPercent(o.weight));
    return m;
  }, [holding.overrides]);

  const [texts, setTexts] = useState<Map<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [hideZero, setHideZero] = useState(true);

  const weightOf = (assetClassId: string) => parsePercent(texts.get(assetClassId));

  const total = assetClasses.reduce((s, ac) => s + weightOf(ac.id), 0);
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
    // Keep digits and a single decimal point; allow partial input like "" or "10.".
    let cleaned = raw.replace(/[^\d.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
    }
    // Reject anything over 100% (a complete value); partial entries still pass through.
    const v = parseFloat(cleaned);
    if (!isNaN(v) && v > 100) return;
    setTexts((prev) => {
      const next = new Map(prev);
      if (cleaned === "") next.delete(assetClassId);
      else next.set(assetClassId, cleaned);
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
    ? assetClasses.filter((ac) => weightOf(ac.id) > 0)
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
        {visible.map((ac) => (
          <div key={ac.id} className="flex items-center justify-between gap-2">
            <span className="flex-1 truncate text-sm text-gray-200">{ac.name}</span>
            <div className="flex w-20 shrink-0 items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={texts.get(ac.id) ?? ""}
                placeholder="0"
                onChange={(e) => setWeight(ac.id, e.target.value)}
                className="h-7 w-full rounded-md border border-gray-600 bg-gray-800 px-2 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          </div>
        ))}
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
            onClick={() =>
              persist(
                assetClasses
                  .map((ac) => ({ assetClassId: ac.id, weight: weightOf(ac.id) }))
                  .filter((e) => e.weight > 0),
              )
            }
            disabled={saving || over}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save override"}
          </button>
        </div>
      </div>
    </div>
  );
}
