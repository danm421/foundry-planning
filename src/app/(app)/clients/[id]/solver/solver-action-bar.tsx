"use client";

interface Props {
  hasMutations: boolean;
  mcRunning: boolean;
  onReset(): void;
  onGenerateMc(): void;
  onSave(): void;
}

export function SolverActionBar({
  hasMutations,
  mcRunning,
  onReset,
  onGenerateMc,
  onSave,
}: Props) {
  return (
    <div className="flex items-center justify-between border-t border-gray-200 pt-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={!hasMutations}
          className="px-3 py-2 text-sm border border-gray-300 rounded disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onGenerateMc}
          disabled={mcRunning}
          className="px-3 py-2 text-sm border border-gray-300 rounded disabled:opacity-50"
        >
          {mcRunning ? "Generating…" : "Generate Monte Carlo"}
        </button>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={!hasMutations}
        className="px-3 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
      >
        Save as scenario…
      </button>
    </div>
  );
}
