"use client";
import { useState } from "react";

interface Props {
  open: boolean;
  initial: string;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}

export function RenameComparisonModal({ open, initial, onCancel, onConfirm }: Props) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-100">Rename comparison</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
        />
        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !name.trim() || name.trim() === initial}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm(name.trim());
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Rename failed");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
