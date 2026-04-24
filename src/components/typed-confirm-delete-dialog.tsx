"use client";

import { useState } from "react";

interface TypedConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText: string; // the string the user must type
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export default function TypedConfirmDeleteDialog({
  open,
  title,
  message,
  confirmText,
  onCancel,
  onConfirm,
}: TypedConfirmDeleteDialogProps) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const matches = value.trim() === confirmText.trim();

  async function handleConfirm() {
    if (!matches) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setValue("");
    onCancel();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={handleCancel} />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-gray-900 border border-gray-600 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
        <p className="mt-3 text-sm text-gray-300">{message}</p>
        <p className="mt-4 text-sm text-gray-400">
          To confirm, type{" "}
          <span className="font-semibold text-gray-100">{confirmText}</span> below:
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="mt-2 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className="rounded-md border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !matches}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
