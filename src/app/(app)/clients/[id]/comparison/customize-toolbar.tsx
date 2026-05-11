"use client";

interface Props {
  onAddText: () => void;
  onReset: () => void;
  onDone: () => void;
  saving: boolean;
}

export function CustomizeToolbar({ onAddText, onReset, onDone, saving }: Props) {
  return (
    <div className="sticky top-[3.25rem] z-10 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-2 text-sm backdrop-blur">
      <span className="font-medium text-slate-200">Customize layout</span>
      <span className="text-slate-700">|</span>
      <button
        type="button"
        onClick={onAddText}
        className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      >
        + Add text block
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      >
        Reset to default
      </button>
      <div className="ml-auto">
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-slate-950 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Done"}
        </button>
      </div>
    </div>
  );
}
