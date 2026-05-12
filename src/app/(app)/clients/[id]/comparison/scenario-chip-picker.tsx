"use client";

import type { ComparisonWidgetScenarios } from "@/lib/comparison/widgets/types";

interface Props {
  cardinality: ComparisonWidgetScenarios;
  scenarios: { id: string; name: string }[];
  planIds: string[];
  onChange: (next: string[]) => void;
}

export function ScenarioChipPicker({ cardinality, scenarios, planIds, onChange }: Props) {
  if (cardinality === "none") return null;

  const minCount = cardinality === "many-only" ? 2 : 1;

  const toggle = (id: string) => {
    const has = planIds.includes(id);
    if (cardinality === "one") {
      if (!has) onChange([id]);
      return;
    }
    if (has) {
      if (planIds.length <= minCount) return;
      onChange(planIds.filter((p) => p !== id));
    } else {
      onChange([...planIds, id]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1">
      {scenarios.map((s) => {
        const selected = planIds.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              selected
                ? "border-amber-400 bg-amber-400/10 text-amber-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
