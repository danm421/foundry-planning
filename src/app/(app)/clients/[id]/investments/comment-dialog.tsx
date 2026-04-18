"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  reportKey: string;
  initialBody: string;
}

export default function CommentDialog({ open, onClose, clientId, reportKey, initialBody }: Props) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/report-comments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportKey, body }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      console.error("Comment save failed:", err);
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <h3 className="mb-3 text-lg font-semibold text-gray-100">Advisor Comment</h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="w-full rounded border border-gray-700 bg-gray-800 p-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          placeholder="Notes for this report…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
