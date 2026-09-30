"use client";

import { useEffect, useRef } from "react";

/**
 * Hands focus mode control back to the Solver's Changes tab host exactly
 * once. Focus mode opens a Details view already pointed at one row; once
 * nothing focus-mode-only is still open (`busy` is false), the view calls
 * `onFocusClose()` if it ever had a target to focus, or
 * `onFocusClose("unavailable")` if it didn't — e.g. the row no longer
 * exists, or (as with Assumptions) the view has no focused editor to open at
 * all. A ref guards the single call against firing again on a later
 * re-render, such as after a save clears the target.
 *
 * Call this unconditionally, before any early return the view takes for
 * focus mode — like every other hook, it must run in the same order on
 * every render.
 */
export function useFocusCloseOnce(
  focus: unknown,
  hasTarget: boolean,
  busy: boolean,
  onFocusClose?: (outcome?: "unavailable") => void,
): void {
  const closedRef = useRef(false);
  useEffect(() => {
    if (!focus || busy || closedRef.current) return;
    closedRef.current = true;
    // Two call shapes, not one with an `undefined` outcome: a host that
    // distinguishes "closed" from "closed with no outcome argument" (as the
    // focus tests do, via `toHaveBeenCalledWith()`) must see the real one.
    if (hasTarget) onFocusClose?.();
    else onFocusClose?.("unavailable");
  }, [focus, hasTarget, busy, onFocusClose]);
}
