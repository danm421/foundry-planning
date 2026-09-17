// src/components/forms/holding-override-editor.tsx
"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AssetClassOption } from "./asset-mix-tab";
import type { HoldingRow } from "@/lib/investments/holdings-client";
import DialogShell from "@/components/dialog-shell";
import { inputCompactClassName } from "./input-styles";
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
  const listRef = useRef<HTMLDivElement | null>(null);

  const weightOf = (assetClassId: string) => parsePercent(texts.get(assetClassId));

  const total = assetClasses.reduce((s, ac) => s + weightOf(ac.id), 0);
  const over = total > 1.0001;
  const remaining = Math.max(0, 1 - total);

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

  /** Enter walks down the list instead of submitting: this dialog renders inside
   *  the account form's DOM, so a bare Enter would submit that form. These
   *  inputs are the only reachable submit path while the dialog is up — its
   *  overlay and focus trap put the form's own Save out of reach — so no
   *  form-level guard is needed the way an inline sub-editor needs one. */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = [...(listRef.current?.querySelectorAll<HTMLInputElement>("input") ?? [])];
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) { next.focus(); next.select(); } else e.currentTarget.blur();
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

  return (
    <DialogShell
      open
      onOpenChange={(next) => { if (!next && !saving) onClose(); }}
      title={`Asset classes — ${holding.displayTicker ?? holding.displayName ?? "holding"}`}
      size="sm"
      primaryAction={{ label: "Save", onClick: handleSave, disabled: over, loading: saving }}
      secondaryAction={{ label: "Cancel", onClick: onClose, disabled: saving }}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 text-xs">
          <p className="text-ink-3">
            {hasPulled ? (
              <>Pulled from holding: <span className="text-ink-2">{pulledText}</span></>
            ) : (
              <>No pulled classification — set the asset classes below.</>
            )}
          </p>
          <span className={customized ? "shrink-0 text-warn" : "shrink-0 text-ink-4"}>{status}</span>
        </div>

        {/* Every class, one per row, so a percentage can be typed straight down
            the list without hunting for the right field. */}
        <div
          ref={listRef}
          data-testid="asset-class-list"
          className="max-h-[min(50vh,420px)] divide-y divide-hair overflow-y-auto rounded-md border border-hair"
        >
          {assetClasses.map((ac, i) => {
            const set = weightOf(ac.id) > 0;
            return (
              <label
                key={ac.id}
                className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-card-hover"
              >
                <span className={`flex-1 truncate text-sm ${set ? "text-ink" : "text-ink-2"}`}>
                  {ac.name}
                </span>
                <span className="flex w-[4.5rem] shrink-0 items-center gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${ac.name} percent`}
                    data-autofocus={i === 0 ? "" : undefined}
                    value={texts.get(ac.id) ?? ""}
                    placeholder="0"
                    onChange={(e) => setWeight(ac.id, e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={handleKeyDown}
                    className={`${inputCompactClassName} tabular text-right`}
                  />
                  <span className="text-sm text-ink-3">%</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <span className={over ? "text-crit" : "text-ink-2"}>
            Total <span className="tabular">{(total * 100).toFixed(1)}%</span>
            {/* Mutually exclusive by construction: `remaining` floors at 0, so
                it is 0 exactly when the blend is over. */}
            {over && " — exceeds 100%"}
            {remaining > 0.0001 && (
              <span className="text-ink-3">
                {" · "}<span className="tabular">{(remaining * 100).toFixed(1)}%</span> unclassified
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={resetToPulled}
            disabled={saving || !hasPulled || !customized}
            className="shrink-0 rounded-[var(--radius-sm)] border border-hair-2 px-3 py-1 text-xs text-ink-2 hover:bg-card-hover disabled:opacity-50"
          >
            Reset to pulled
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
