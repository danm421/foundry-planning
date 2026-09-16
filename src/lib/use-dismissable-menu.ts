import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

/**
 * Open/closed state for a dropdown that closes on Escape or on a click
 * outside it. Put `ref` on the element wrapping BOTH the trigger and the
 * panel — a click anywhere inside that element counts as inside.
 *
 * Listeners are bound only while the menu is open, so a page full of closed
 * menus costs nothing. Shared rather than copied because the two menus that
 * need it look nothing alike — `OverflowMenu` is a 28px kebab with a
 * right-anchored panel, the portal rail's "Add Account" is a full-width accent
 * CTA — and only this dismissal behaviour is common to both.
 */
export function useDismissableMenu<T extends HTMLElement>(): {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  ref: RefObject<T | null>;
} {
  const [open, setOpen] = useState(false);
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { open, setOpen, ref };
}
