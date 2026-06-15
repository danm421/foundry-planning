"use client";

import { useEffect, useState } from "react";

import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";
import { RichTextEditor } from "@/components/rich-text-editor";
import type { NoteRow, NoteKind } from "@/lib/crm/notes";

const TYPE_OPTIONS: { value: NoteKind; label: string }[] = [
  { value: "note", label: "General" },
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
];

function todayLocal(): string {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}

// occurredAt is stored at noon UTC; its date portion is the entered date.
function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  note: NoteRow | null; // null = create mode
  onSaved: () => void;
}

export function CrmNoteDialog({ open, onOpenChange, householdId, note, onSaved }: Props) {
  const isEdit = note !== null;
  const [subject, setSubject] = useState("");
  const [noteKind, setNoteKind] = useState<NoteKind>("note");
  const [noteDate, setNoteDate] = useState(todayLocal());
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (note) {
      setSubject(note.title);
      setNoteKind(note.kind);
      setNoteDate(isoToDateInput(note.occurredAt));
      setBody(note.body);
    } else {
      setSubject("");
      setNoteKind("note");
      setNoteDate(todayLocal());
      setBody("");
    }
  }, [open, note]);

  async function onSave() {
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const url = isEdit
        ? `/api/crm/households/${householdId}/notes/${note!.id}`
        : `/api/crm/households/${householdId}/notes`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body, noteKind, noteDate }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Save failed (${res.status})`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete() {
    if (!note) return;
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/households/${householdId}/notes/${note.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Delete failed (${res.status})`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit note" : "New note"}
      size="lg"
      primaryAction={{ label: "Save", onClick: onSave, loading: submitting }}
      destructiveAction={
        isEdit
          ? { label: deleting ? "Deleting…" : "Delete", onClick: onDelete, loading: deleting }
          : undefined
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="note-type">Type</label>
            <select
              id="note-type"
              value={noteKind}
              onChange={(e) => setNoteKind(e.target.value as NoteKind)}
              className={selectClassName}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="note-date">Date</label>
            <input
              id="note-date"
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="note-subject">
            Subject <span className="text-crit">*</span>
          </label>
          <input
            id="note-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={300}
            placeholder="Short summary"
            className={inputClassName}
          />
        </div>

        <div>
          <span className={fieldLabelClassName}>Notes</span>
          <div className="mt-1 rounded-[var(--radius-sm)] border border-hair bg-card">
            <RichTextEditor value={body} onChange={setBody} placeholder="Meeting notes…" />
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
