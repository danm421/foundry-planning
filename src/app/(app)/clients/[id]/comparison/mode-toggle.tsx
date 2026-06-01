"use client";

export type CanvasMode = "layout" | "preview";

interface Props {
  mode: CanvasMode;
  onChange: (next: CanvasMode) => void;
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Canvas mode"
      className="inline-flex overflow-hidden rounded border border-hair text-xs"
    >
      {(["layout", "preview"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`px-3 py-1 capitalize ${
            mode === m ? "bg-accent text-accent-on" : "text-ink hover:bg-card-hover"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
