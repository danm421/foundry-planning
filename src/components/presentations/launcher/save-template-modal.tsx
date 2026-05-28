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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md rounded bg-white p-5 space-y-4 shadow-lg">
        <h2 className="text-lg font-semibold">Save as template</h2>
        <label className="block">
          <span className="text-sm text-gray-700">Template name</span>
          <input
            type="text"
            aria-label="Template name"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm text-gray-700">Visibility</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              aria-label="Private to me"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            <span>Private to me</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              aria-label="Shared with firm"
              checked={visibility === "shared"}
              onChange={() => setVisibility("shared")}
            />
            <span>Shared with firm</span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim() === ""}
            onClick={() =>
              props.onSave({ name: name.trim(), visibility })
            }
            className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
