// src/components/reports/preview-toggle.tsx
//
// Segmented control switching the canvas between `"edit"` and
// `"preview"`. In preview mode, `WidgetFrame` and the empty-slot
// dashed div short-circuit their chrome — see `widget-frame.tsx` and
// `canvas-row.tsx`.

"use client";

export function PreviewToggle({
  value,
  onChange,
}: {
  value: "edit" | "preview";
  onChange: (v: "edit" | "preview") => void;
}) {
  return (
    <div className="inline-flex bg-card-2 border border-hair rounded-md p-0.5">
      {(["edit", "preview"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`h-7 px-3 text-[12px] rounded ${
            value === v ? "bg-card text-ink" : "text-ink-3 hover:text-ink"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
