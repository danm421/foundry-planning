"use client";

import { useState, type ReactNode } from "react";

interface CrmTaskFieldRowProps<T> {
  label: string;
  value: ReactNode;
  /** Initial editor value when entering edit mode. Use the raw form value
   *  (string for inputs, etc.), not the formatted display. */
  initial: T;
  /** Persists the edited value. Should throw on failure so the row can
   *  surface an error and stay in edit mode. */
  onSave: (next: T) => Promise<void> | void;
  /** Renders the editor in edit mode. Caller controls the editor type
   *  (input/select/textarea/etc.); this row just owns swap + commit. */
  editor: (args: {
    value: T;
    setValue: (next: T) => void;
    commit: () => Promise<void>;
    cancel: () => void;
  }) => ReactNode;
  /** Some fields don't make sense to edit inline (e.g. created-by). When
   *  false the value renders without click-to-edit affordance. */
  editable?: boolean;
}

/**
 * Generic label/value row used in the side panel's Details tab. Click
 * the value to swap into the inline editor; the editor commits on its
 * own callback (typically blur or enter) by calling `commit()`.
 *
 * Save errors are caught here so the field stays in edit mode and shows
 * an inline error — the editor itself doesn't need to track failure.
 */
export function CrmTaskFieldRow<T>({
  label,
  value,
  initial,
  onSave,
  editor,
  editable = true,
}: CrmTaskFieldRowProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    if (!editable) return;
    setDraft(initial);
    setEditing(true);
    setError(null);
  }

  async function commit() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="flex items-start gap-3 border-b border-hair px-1 py-2.5 last:border-b-0">
      <div className="w-32 shrink-0 pt-0.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1">
            {editor({ value: draft, setValue: setDraft, commit, cancel })}
            {saving && <p className="text-[11px] text-ink-3">Saving…</p>}
            {error && (
              <p role="alert" className="text-[11px] text-crit">
                {error}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={!editable}
            className={
              "block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[13px] " +
              (editable
                ? "text-ink hover:bg-card-2"
                : "cursor-default text-ink-2")
            }
          >
            {value}
          </button>
        )}
      </div>
    </div>
  );
}
