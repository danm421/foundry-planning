"use client";
import { useState } from "react";

interface Plan {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  templateName: string;
  slotLabels: string[];
  clientPlans: Plan[];
  defaultName: string;
  onCancel: () => void;
  onConfirm: (args: { name: string; slotMappings: Record<string, string> }) => Promise<void>;
}

const SLOT_TOKENS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function SlotMappingModal({
  open,
  templateName,
  slotLabels,
  clientPlans,
  defaultName,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const tokens = SLOT_TOKENS.slice(0, slotLabels.length);
  const allMapped = tokens.every((t) => mappings[t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-100">
          Apply &ldquo;{templateName}&rdquo;
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Pick which of this client&apos;s plans fills each slot.
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-200">
          Name your comparison
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
        />

        <div className="mt-5 space-y-3">
          {tokens.map((token, i) => (
            <div key={token} className="flex items-center gap-3">
              <div className="w-32 text-sm font-medium text-slate-200">
                Slot {token}{" "}
                <span className="text-slate-500">— {slotLabels[i]}</span>
              </div>
              <select
                value={mappings[token] ?? ""}
                onChange={(e) =>
                  setMappings((m) => ({ ...m, [token]: e.target.value }))
                }
                className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
              >
                <option value="">Select a plan…</option>
                {clientPlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

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
            disabled={!allMapped || !name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm({ name: name.trim(), slotMappings: mappings });
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Failed to create comparison");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create comparison"}
          </button>
        </div>
      </div>
    </div>
  );
}
