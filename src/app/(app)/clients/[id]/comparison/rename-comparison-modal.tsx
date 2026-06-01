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
      <div className="w-full max-w-sm rounded-lg border border-hair bg-card p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-ink">Rename comparison</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 w-full rounded-md border border-hair bg-card-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        {err && <p className="mt-3 text-sm text-crit">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-hair bg-card px-4 py-2 text-sm text-ink-2 hover:bg-card-hover"
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
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
