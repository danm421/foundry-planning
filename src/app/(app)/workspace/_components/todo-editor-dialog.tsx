"use client";

import { useId, useState, type FormEvent, type ReactElement } from "react";
import DialogShell from "@/components/dialog-shell";
import { fieldLabelClassName, inputClassName, textareaClassName } from "@/components/forms/input-styles";
import type { WorkspaceTodo } from "@/lib/workspace/types";

/** A subset of `PATCH /api/workspace/todos/[listId]/[taskId]`'s body: only what changed. */
export type TodoPatch = { title?: string; dueDate?: string | null; notes?: string };

const FORM_ID = "workspace-todo-editor";
const SAVE_FAILED = "Couldn't save the to-do. Try again.";

/**
 * Edits one Outlook to-do. Save sends only the fields the advisor changed;
 * nothing changed, Save just closes. Formatted (HTML) notes can't be shown in
 * a plain-text box, so they aren't offered at all — typing into an empty box
 * would replace notes the advisor never saw — and Save never sends `notes`.
 */
export function TodoEditorDialog({
  todo,
  onSave,
  onClose,
}: {
  todo: WorkspaceTodo;
  /** Rejects to keep the dialog open with an error; the caller closes it on success. */
  onSave: (patch: TodoPatch) => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const ids = useId();
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(todo.dueDate ?? "");
  const [notes, setNotes] = useState(todo.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = title.trim() !== "" && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const patch: TodoPatch = {};
    if (title.trim() !== todo.title) patch.title = title.trim();
    if ((due || null) !== todo.dueDate) patch.dueDate = due || null;
    if (!todo.notesAreHtml && notes !== todo.notes) patch.notes = notes;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(patch);
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string) => `${ids}-${name}`;

  return (
    <DialogShell
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit to-do"
      size="sm"
      primaryAction={{ label: "Save", form: FORM_ID, disabled: !canSave, loading: busy }}
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor={field("title")} className={fieldLabelClassName}>
            Title
          </label>
          <input
            id={field("title")}
            data-autofocus
            className={inputClassName}
            value={title}
            maxLength={255}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={field("due")} className={fieldLabelClassName}>
            Due date
          </label>
          <input
            id={field("due")}
            type="date"
            className={`${inputClassName} tabular`}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        {todo.notesAreHtml ? (
          <div>
            <p className={fieldLabelClassName}>Notes</p>
            <p className="text-[13px] text-ink-3">This to-do has formatted notes. Edit them in Outlook.</p>
          </div>
        ) : (
          <div>
            <label htmlFor={field("notes")} className={fieldLabelClassName}>
              Notes
            </label>
            <textarea
              id={field("notes")}
              rows={4}
              className={textareaClassName}
              value={notes}
              maxLength={10000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        )}
        {error ? (
          <p role="alert" className="text-[13px] text-crit">
            {error}
          </p>
        ) : null}
      </form>
    </DialogShell>
  );
}
