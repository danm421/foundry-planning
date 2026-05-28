"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  initialName: string;
  initialVisibility?: "shared" | "private";
  onSave: (input: { name: string; visibility: "shared" | "private" }) => void;
  onCancel: () => void;
}

export function SaveTemplateModal(props: Props) {
  const [name, setName] = useState(props.initialName);
  const [visibility, setVisibility] = useState<"shared" | "private">(
    props.initialVisibility ?? "private",
  );

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md rounded border border-hair bg-card p-6 space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold text-ink">Save as template</h2>
        <label className="block space-y-1">
          <span className="block text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Template name
          </span>
          <input
            type="text"
            aria-label="Template name"
            className="w-full rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Visibility
          </legend>
          <label className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
            <input
              type="radio"
              aria-label="Private to me"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
              className="accent-accent"
            />
            <span>Private to me</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
            <input
              type="radio"
              aria-label="Shared with firm"
              checked={visibility === "shared"}
              onChange={() => setVisibility("shared")}
              className="accent-accent"
            />
            <span>Shared with firm</span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded border border-transparent px-3 py-2 text-sm text-ink-3 transition-colors hover:bg-card-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim() === ""}
            onClick={() => props.onSave({ name: name.trim(), visibility })}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
