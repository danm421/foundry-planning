"use client";
import { useState } from "react";

interface Props {
  open: boolean;
  initialName: string;
  defaultSlotLabels: string[];
  onCancel: () => void;
  onConfirm: (args: {
    name: string;
    description: string | null;
    visibility: "private" | "firm";
    slotLabels: string[];
  }) => Promise<void>;
}

export function SaveAsTemplateModal({
  open,
  initialName,
  defaultSlotLabels,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "firm">("private");
  const [labels, setLabels] = useState<string[]>(defaultSlotLabels);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-100">Save as template</h2>

        <label className="mt-5 block text-sm font-medium text-slate-200">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
        />

        <label className="mt-4 block text-sm font-medium text-slate-200">
          Description (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
        />

        <div className="mt-4">
          <div className="text-sm font-medium text-slate-200">Visibility</div>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="radio"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private (only me)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="radio"
                checked={visibility === "firm"}
                onChange={() => setVisibility("firm")}
              />
              Shared with firm
            </label>
          </div>
        </div>

        {labels.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-slate-200">Slot labels</div>
            <p className="text-xs text-slate-400">
              These appear when someone applies this template to a client.
            </p>
            <div className="mt-2 space-y-2">
              {labels.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-12 font-mono text-xs text-slate-500">
                    Slot {String.fromCharCode(65 + i)}
                  </div>
                  <input
                    value={l}
                    onChange={(e) =>
                      setLabels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {err && <p className="mt-4 text-sm text-red-400">{err}</p>}

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
            disabled={busy || !name.trim() || labels.some((l) => !l.trim())}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm({
                  name: name.trim(),
                  description: description.trim() || null,
                  visibility,
                  slotLabels: labels.map((l) => l.trim()),
                });
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Failed to save template");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}
