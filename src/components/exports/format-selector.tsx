"use client";

import type { Variant } from "@/lib/report-artifacts/types";

const LABELS: Record<Variant, string> = {
  chart: "Chart only (PDF)",
  data: "Data only (PDF)",
  "chart+data": "Chart + data (PDF)",
  csv: "Data only (CSV)",
};

export function FormatSelector({
  variants,
  value,
  onChange,
}: {
  variants: readonly Variant[];
  value: Variant;
  onChange: (v: Variant) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
        Format
      </legend>
      {variants.map((v) => (
        <label
          key={v}
          className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 bg-gray-800/40 px-3 py-2 text-sm text-gray-200 hover:border-gray-600 hover:bg-gray-800"
        >
          <input
            type="radio"
            name="export-format"
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
            className="accent-accent"
          />
          {LABELS[v]}
        </label>
      ))}
    </fieldset>
  );
}
