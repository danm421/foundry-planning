"use client";

import { useEffect, useRef, useState } from "react";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";

/**
 * Focus mode's delete intent opens no dialog, so the view has nothing that keeps
 * `useFocusCloseOnce` from handing control back at mount, before the delete has
 * run. This hook runs the delete once and returns the in-flight flag the view
 * must OR into that hook's `busy`.
 *
 * `run` is the page's own delete (silent: no alert), resolving true when the row
 * is gone; it is null when the focus is not a delete. The flag starts true
 * synchronously for a delete, so the close hook never sees an idle first render.
 * - Success: the flag clears and `useFocusCloseOnce` closes with no outcome.
 * - Failure (false or a rejection): the flag stays set, keeping that hook quiet,
 *   and this hook calls `onFocusClose("failed")` itself, once.
 * Nothing is called after the view unmounts. The latest `run` and `onFocusClose`
 * are used, not the mount-time ones.
 */
export function useFocusDelete(
  run: (() => Promise<boolean>) | null,
  onFocusClose?: (outcome?: FocusCloseOutcome) => void,
): boolean {
  const [deleting, setDeleting] = useState(run !== null);
  const startedRef = useRef(false);
  const mountedRef = useRef(false);
  const runRef = useRef(run);
  const closeRef = useRef(onFocusClose);
  useEffect(() => {
    runRef.current = run;
    closeRef.current = onFocusClose;
  });

  useEffect(() => {
    // Set before the run-once guard: StrictMode's simulated unmount clears it,
    // and the re-run must put it back without starting a second delete.
    mountedRef.current = true;
    if (!startedRef.current && runRef.current) {
      startedRef.current = true;
      runRef
        .current()
        .catch(() => false)
        .then((ok) => {
          if (!mountedRef.current) return;
          if (ok) setDeleting(false);
          else closeRef.current?.("failed");
        });
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return deleting;
}
