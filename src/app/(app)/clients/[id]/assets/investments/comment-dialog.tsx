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
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/report-comments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportKey, body }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      console.error("Comment save failed:", err);
      setError("Couldn't save your comment. Please try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border-2 border-hair-2 ring-1 ring-black/60 bg-card p-6 shadow-xl">
        <h3 className="mb-3 text-lg font-semibold text-ink">Advisor Comment</h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="w-full rounded border border-hair-2 bg-card-2 p-2 text-sm text-ink focus:border-accent focus:outline-none"
          placeholder="Notes for this report…"
        />
        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border border-hair-2 bg-card-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-card-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
