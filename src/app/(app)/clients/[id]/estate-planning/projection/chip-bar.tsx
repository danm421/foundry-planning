"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanSettings } from "@/engine/types";
import { ChipEditor, type ChipFormat } from "./chip-editor";

interface Props {
  clientId: string;
  planSettings: PlanSettings;
  onOpenAssumptions: () => void;
}

/**
 * Field set restricted to engine PlanSettings (see engine/types.ts).
 * Plan pseudocode listed `defaultGrowthTaxable` — that field lives on the DB
 * row but is not on engine PlanSettings, so flatFederalRate stands in as the
 * most-edited tax assumption. `federalEstateExemption` doesn't exist anywhere.
 */
const CHIPS: Array<{
  key: "flatFederalRate" | "inflationRate" | "planEndYear" | "flatStateEstateRate";
  label: string;
  format: ChipFormat;
}> = [
  { key: "flatFederalRate", label: "Federal tax %", format: "pct" },
  { key: "inflationRate", label: "Inflation %", format: "pct" },
  { key: "planEndYear", label: "Plan end year", format: "year" },
  { key: "flatStateEstateRate", label: "State estate %", format: "pct" },
];

export function ChipBar({ clientId, planSettings, onOpenAssumptions }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const router = useRouter();

  async function handleSave(key: string, next: number) {
    const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    });
    if (!res.ok) {
      // Surface backend validation errors in the inline editor.
      let msg = `${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) msg = body.error;
      } catch {
        // Body wasn't JSON — fall through with status code.
      }
      throw new Error(msg);
    }
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-hair pb-3">
      <h2 className="text-base font-medium text-ink">Projection &amp; Comparison</h2>
      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] uppercase text-accent">
        Live
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => {
          const raw = planSettings[c.key];
          const numeric = raw == null ? 0 : Number(raw);
          return (
            <div key={c.key} className="relative">
              <button
                type="button"
                onClick={() => setEditing(editing === c.key ? null : c.key)}
                className="rounded border border-hair bg-card-2 px-2 py-1 text-[12px] text-ink hover:bg-card-hover"
              >
                {c.label}:{" "}
                <span className="font-mono tabular-nums text-ink">
                  {formatChip(numeric, c.format)}
                </span>
              </button>
              {editing === c.key && (
                <div className="absolute right-0 top-full z-30 mt-2">
                  <ChipEditor
                    label={c.label}
                    currentValue={numeric}
                    format={c.format}
                    onSave={(v) => handleSave(c.key, v)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onOpenAssumptions}
          className="text-[12px] text-ink-3 underline hover:text-ink"
        >
          Edit assumptions
        </button>
      </div>
    </div>
  );
}

function formatChip(n: number, format: ChipFormat): string {
  if (Number.isNaN(n)) return "—";
  if (format === "pct") return `${(n * 100).toFixed(1)}%`;
  if (format === "year") return String(Math.round(n));
  if (format === "currency") return `$${Math.round(n).toLocaleString()}`;
  return String(n);
}
