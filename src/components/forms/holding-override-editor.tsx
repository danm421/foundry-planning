// src/components/forms/holding-override-editor.tsx
"use client";

import { useMemo, useState } from "react";
import type { AssetClassOption } from "./asset-mix-tab";
import type { HoldingRow } from "@/lib/investments/holdings-client";
import {
  pulledBlend,
  blendFromEntries,
  blendsEqual,
  formatPercent,
  parsePercent,
} from "@/lib/investments/holding-blend";

interface Props {
  holding: HoldingRow;
  assetClasses: AssetClassOption[];
  /** Persist the blend ([] clears the override → keep tracking the pulled blend). */
  onSave: (overrides: { assetClassId: string; weight: number }[]) => Promise<void>;
  onClose: () => void;
}

export function HoldingOverrideEditor({ holding, assetClasses, onSave, onClose }: Props) {
  // The security's pulled blend (assetClassId → fraction). Empty for a fully
  // manual holding with no security to classify.
  const pulled = useMemo(
    () => pulledBlend(holding.securityWeights, assetClasses),
    [holding.securityWeights, assetClasses],
  );

  // Seed the editable fields from the saved override if one exists, else from
  // the pulled blend so the panel opens showing what the security resolved to.
  const initial = useMemo(() => {
    const m = new Map<string, string>();
    const source = holding.overrides.length > 0 ? blendFromEntries(holding.overrides) : pulled;
    for (const [id, w] of source) m.set(id, formatPercent(w));
    return m;
  }, [holding.overrides, pulled]);

  const [texts, setTexts] = useState<Map<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [hideZero, setHideZero] = useState(true);

  const weightOf = (assetClassId: string) => parsePercent(texts.get(assetClassId));

  const total = assetClasses.reduce((s, ac) => s + weightOf(ac.id), 0);
  const over = total > 1.0001;

  const current = blendFromEntries(
    assetClasses.map((ac) => ({ assetClassId: ac.id, weight: weightOf(ac.id) })),
  );
  const hasPulled = pulled.size > 0;
  // "Customized" = fields differ from the pulled blend. When they match, Save
  // clears the override so the holding keeps tracking future re-classification.
  const customized = !blendsEqual(current, pulled);
  const status = customized ? "Customized" : hasPulled ? "Tracking pulled blend" : "Unclassified";

  // Pulled blend rendered as a read-only reference (firm class name → %).
  const pulledText = [...pulled.entries()]
    .map(([id, w]) => {
      const ac = assetClasses.find((c) => c.id === id);
      return ac ? `${ac.name} ${(w * 100).toFixed(0)}%` : null;
    })
    .filter(Boolean)
    .join(" · ");

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

  function resetToPulled() {
    const m = new Map<string, string>();
    for (const [id, w] of pulled) m.set(id, formatPercent(w));
    setTexts(m);
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

  function handleSave() {
    // Still matches the pulled blend → clear the override (stay derived); a real
    // customization persists the blend (chip flips to Manual).
    if (!customized) {
      persist([]);
      return;
    }
    persist(
      assetClasses
        .map((ac) => ({ assetClassId: ac.id, weight: weightOf(ac.id) }))
        .filter((e) => e.weight > 0),
    );
  }

  const visible = hideZero
    ? assetClasses.filter((ac) => weightOf(ac.id) > 0)
    : assetClasses;

  return (
    <div className="space-y-3 rounded-md border border-gray-700 bg-gray-900/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">
          Asset classes — {holding.displayTicker ?? holding.displayName ?? "holding"}
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

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <p className="text-gray-400">
          {hasPulled ? (
            <>
              Pulled from holding: <span className="text-gray-300">{pulledText}</span>. Adjust any
              row to customize.
            </>
          ) : (
            <>No pulled classification — set the asset classes manually below.</>
          )}
        </p>
        <span className={customized ? "shrink-0 text-amber-300" : "shrink-0 text-gray-500"}>
          {status}
        </span>
      </div>

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
            onClick={resetToPulled}
            disabled={saving || !hasPulled || !customized}
            className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Reset to pulled
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
            onClick={handleSave}
            disabled={saving || over}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
