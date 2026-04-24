"use client";

import { useEffect, useState } from "react";

type Priority = "low" | "medium" | "high";

export type OpenItemDialogValue = {
  title: string;
  priority: Priority;
  dueDate: string | null; // yyyy-mm-dd
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (value: OpenItemDialogValue) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  editing?: {
    title: string;
    priority: Priority;
    dueDate: string | null;
  };
};

export default function OpenItemDialog({
  open,
  onOpenChange,
  onSubmit,
  onDelete,
  editing,
}: Props) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? "medium");
  const [dueDate, setDueDate] = useState<string>(editing?.dueDate ?? "");
  const [busy, setBusy] = useState(false);

  // Remount-on-open: reset state each time dialog opens (fix #26)
  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setPriority(editing?.priority ?? "medium");
      setDueDate(editing?.dueDate ?? "");
    }
  }, [open, editing]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => !busy && onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-100">
          {editing ? "Edit open item" : "New open item"}
        </h2>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Title</span>
            <input
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Priority</span>
            <select
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Due date</span>
            <input
              type="date"
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          {editing && onDelete ? (
            <button
              type="button"
              className="rounded border border-red-700 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/20"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await onDelete(); onOpenChange(false); } finally { setBusy(false); }
              }}
            >
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={busy || title.trim().length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSubmit({
                    title: title.trim(),
                    priority,
                    dueDate: dueDate || null,
                  });
                  onOpenChange(false);
                } finally { setBusy(false); }
              }}
            >
              {editing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
