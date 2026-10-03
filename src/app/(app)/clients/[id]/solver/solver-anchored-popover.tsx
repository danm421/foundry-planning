"use client";

// The Add menu's and the Edit/Delete picker's shared shell: a `document.body`
// portal, `position: fixed` under its anchor (flipping up / clamping at a
// viewport edge), closed by an outside mousedown, Escape, a page scroll or a
// resize. The solver's left column is `overflow-y-auto`, so an in-flow box
// would be clipped by it.
//
// Keyboard: the portal sits at the end of `<body>`, so on open focus moves to
// the first enabled control (unless something inside already took it — the
// picker's autofocused search), leaving the popover by Tab closes it, and
// closing hands focus back to the anchor (or the first focusable control inside
// it) when it was inside.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const GAP = 4; // px between anchor and popover
const MARGIN = 8; // px viewport inset

type Anchor = HTMLElement | RefObject<HTMLElement | null>;

// A ref is read only inside effects and handlers, never during render.
const anchorEl = (anchor: Anchor): HTMLElement | null => ("current" in anchor ? anchor.current : anchor);

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where focus returns on close: the anchor when it can take focus, else its
 *  first focusable descendant. The Solve rows anchor on a plain wrapper <div>
 *  around the icon button, and focusing that div would drop focus on <body>. */
const focusReturnTarget = (el: HTMLElement): HTMLElement | null =>
  el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);

interface Props {
  /** The trigger the popover hangs off: the element, or a ref to it. */
  anchor: Anchor;
  /** Accessible name of the popover's dialog. */
  label: string;
  onClose: () => void;
  /** Tailwind width/size classes; the popover supplies the surface itself. */
  className?: string;
  /** A CSS colour that frames the popover in place of the neutral hairline,
   *  and is handed to its contents as `--tone` for their own tinting. */
  tone?: string;
  children: ReactNode;
}

export function SolverAnchoredPopover({ anchor, label, onClose, className = "w-64", tone, children }: Props) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // True while focus is inside the panel, so unmount knows whether to give it back.
  const hadFocusRef = useRef(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!panel.contains(document.activeElement)) {
      // A control marked `data-autofocus` (DialogShell's convention) is the entry point.
      (
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])")
      )?.focus({ preventScroll: true });
    }
    return () => {
      if (!hadFocusRef.current) return;
      const el = anchorEl(anchor);
      if (el) focusReturnTarget(el)?.focus({ preventScroll: true });
    };
  }, [anchor]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const trigger = anchorEl(anchor);
    if (!trigger) return;
    const a = trigger.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    let left = a.left;
    if (left + p.width > window.innerWidth - MARGIN) left = a.right - p.width;
    left = Math.max(MARGIN, left);
    let top = a.bottom + GAP;
    if (top + p.height > window.innerHeight - MARGIN) top = a.top - p.height - GAP;
    top = Math.max(MARGIN, top);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot layout measurement on mount; coords isn't a dep so there's no cascade.
    setCoords({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      // The anchor's own click toggles the popover; closing here would reopen it.
      if (anchorEl(anchor)?.contains(t)) return;
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // A scroll inside the popover (its own list) must not dismiss it.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      onFocus={() => {
        hadFocusRef.current = true;
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        // A null target is the window losing focus, not the advisor tabbing away.
        if (!to || e.currentTarget.contains(to)) return;
        hadFocusRef.current = false;
        // The anchor's own click toggles the popover; closing here would reopen it.
        if (!anchorEl(anchor)?.contains(to)) onClose();
      }}
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        opacity: coords ? 1 : 0,
        ...(tone && ({ borderColor: tone, "--tone": tone } as CSSProperties)),
      }}
      className={`z-50 rounded-md border border-hair-2 bg-card shadow-lg transition-opacity motion-reduce:transition-none ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
