"use client";

import { useEffect, useState } from "react";

import DialogShell from "@/components/dialog-shell";
import { AlertCircleIcon } from "@/components/icons";
import { RichTextEditor } from "@/components/rich-text-editor";
import { todayLocalDate } from "@/lib/crm/quick-note";
import {
  readQuickNoteDraft,
  writeQuickNoteDraft,
  clearQuickNoteDraft,
} from "@/lib/quick-note-draft";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Authenticated advisor id. Empty (auth not yet resolved) disables draft
   *  persistence but the dialog still works for the current session. */
  userId: string;
}

/**
 * Lightweight CRM note capture from the topbar: body only — subject, kind
 * ("note"), and date are derived server-side. The body autosaves to
 * localStorage on every change and survives closing the dialog, navigation,
 * and reload; it clears only on a successful save or an explicit Discard.
 */
export function QuickNoteDialog({ open, onOpenChange, clientId, userId }: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the stored draft each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBody(userId ? (readQuickNoteDraft(clientId, userId) ?? "") : "");
  }, [open, clientId, userId]);

  function onBodyChange(next: string) {
    setBody(next);
    if (userId) writeQuickNoteDraft(clientId, userId, next);
  }

  async function onSave() {
    if (!body.trim()) {
      setError("Write something first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/crm-note`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, noteDate: todayLocalDate() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Save failed (${res.status})`);
      }
      if (userId) clearQuickNoteDraft(clientId, userId);
      setBody("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  function onDiscard() {
    if (body.trim() && !window.confirm("Discard this draft?")) return;
    if (userId) clearQuickNoteDraft(clientId, userId);
    setBody("");
    onOpenChange(false);
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Add CRM note"
      size="md"
      primaryAction={{ label: "Save to CRM", onClick: onSave, loading: submitting }}
      destructiveAction={{ label: "Discard", onClick: onDiscard }}
    >
      <div className="space-y-3">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card">
          <RichTextEditor value={body} onChange={onBodyChange} placeholder="Jot a note…" />
        </div>
        <p className="text-xs text-ink-4">
          Saved to this client’s CRM notes. Closing keeps your draft on this device.
        </p>
      </div>
    </DialogShell>
  );
}
