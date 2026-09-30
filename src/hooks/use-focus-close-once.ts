"use client";

import { useEffect, useRef } from "react";

/**
 * Why focus mode opened no editor, as reported through `onFocusClose`:
 * - `"unavailable"`: the page itself offers no editor for the row here — it's
 *   gone, its kind isn't edited here, the advisor has view-only access… The
 *   host links to the Details page.
 * - `"unsupported"`: the row is there, but its editor is known to write the
 *   base plan (or revert the scenario's change) inside a scenario (Ruling
 *   F-I2). The host explains, with no link — the page has the same bug.
 */
export type FocusCloseOutcome = "unavailable" | "unsupported";

/**
 * Hands focus mode control back to the Solver's Changes tab host exactly
 * once. Focus mode opens a Details view already pointed at one row; once
 * nothing focus-mode-only is still open (`busy` is false), the view calls
 * `onFocusClose()` if it found a row to open, or `onFocusClose(outcome)` if it
 * didn't. `found` is what the view found for the focus, snapshotted at mount:
 * the row it opened (any object), `"unsupported"`, or null ("unavailable" —
 * e.g. the row no longer exists, or, as with Assumptions, the view has no
 * focused editor at all). A ref guards the single call against firing again
 * on a later re-render, such as after a save clears the target.
 *
 * Call this unconditionally, before any early return the view takes for
 * focus mode — like every other hook, it must run in the same order on
 * every render.
 */
export function useFocusCloseOnce(
  focus: unknown,
  found: object | "unsupported" | null,
  busy: boolean,
  onFocusClose?: (outcome?: FocusCloseOutcome) => void,
): void {
  const closedRef = useRef(false);
  useEffect(() => {
    if (!focus || busy || closedRef.current) return;
    closedRef.current = true;
    // Distinct call shapes, never one with an `undefined` outcome: a host that
    // distinguishes "closed" from "closed with no outcome argument" (as the
    // focus tests do, via `toHaveBeenCalledWith()`) must see the real one.
    if (found === null) onFocusClose?.("unavailable");
    else if (found === "unsupported") onFocusClose?.("unsupported");
    else onFocusClose?.();
  }, [focus, found, busy, onFocusClose]);
}
