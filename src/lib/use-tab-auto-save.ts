"use client";

import { useCallback, useRef, useState } from "react";

export type SaveResult = { ok: true } | { ok: false; error: string };

interface UseTabAutoSaveOpts {
  /** True when the form has unsaved edits compared to the last-saved snapshot. */
  isDirty: boolean;
  /** True when client-side validation passes for the current tab. */
  canSave: boolean;
  /** Performs the save. Resolves to {ok:true} or {ok:false, error}. */
  saveAsync: () => Promise<SaveResult>;
  /** Called when interception runs but canSave is false. The dialog uses this
   *  to flag invalid fields (e.g. set aria-invalid on the offending input). */
  onBlocked?: () => void;
}

interface UseTabAutoSave {
  /** Replacement for `onTabChange`. Runs save if dirty + valid, then `applyTabChange(id)`. */
  interceptTabChange: (nextId: string, applyTabChange: (id: string) => void) => Promise<void>;
  /** True while saveAsync is in flight. Render the Saving indicator off this. */
  saving: boolean;
  /** Server-error message from the last failed auto-save, or null. */
  saveError: string | null;
  /** Clear `saveError`. Call from the error chip's dismiss button. */
  clearSaveError: () => void;
}

export function useTabAutoSave(opts: UseTabAutoSaveOpts): UseTabAutoSave {
  const { isDirty, canSave, saveAsync, onBlocked } = opts;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Ref-based lock so a second tab click during an in-flight save is dropped
  // without depending on the React state update cycle.
  const savingRef = useRef(false);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  const interceptTabChange = useCallback(
    async (nextId: string, applyTabChange: (id: string) => void) => {
      if (savingRef.current) return;
      if (!isDirty) {
        applyTabChange(nextId);
        return;
      }
      if (!canSave) {
        onBlocked?.();
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      let result: SaveResult;
      try {
        result = await saveAsync();
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Save failed" };
      }
      savingRef.current = false;
      setSaving(false);
      if (result.ok) {
        applyTabChange(nextId);
      } else {
        setSaveError(result.error);
      }
    },
    [isDirty, canSave, saveAsync, onBlocked],
  );

  return { interceptTabChange, saving, saveError, clearSaveError };
}
