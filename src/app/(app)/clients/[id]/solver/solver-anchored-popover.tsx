"use client";

// The Add menu's and the Edit/Delete picker's shared shell: a `document.body`
// portal, `position: fixed` under its anchor (flipping up / clamping at a
// viewport edge), closed by an outside mousedown, Escape, a page scroll or a
// resize. Same placement rules as `SolverSolvePopover`; the solver's left
// column is `overflow-y-auto`, so an in-flow box would be clipped by it.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 4; // px between anchor and popover
const MARGIN = 8; // px viewport inset

interface Props {
  anchor: HTMLElement;
  /** Accessible name of the popover's dialog. */
  label: string;
  onClose: () => void;
  /** Tailwind width/size classes; the popover supplies the surface itself. */
  className?: string;
  children: ReactNode;
}

export function SolverAnchoredPopover({ anchor, label, onClose, className = "w-64", children }: Props) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const a = anchor.getBoundingClientRect();
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
      if (anchor.contains(t)) return;
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
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        opacity: coords ? 1 : 0,
      }}
      className={`z-50 rounded-md border border-hair-2 bg-card shadow-lg transition-opacity motion-reduce:transition-none ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
