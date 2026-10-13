"use client";
// src/components/fact-finder/side-panel.tsx
// The collapsible panel on the right of the fact finder screen. Beside the page
// at 1100 px and wider; below that, an overlay drawer (the CRM task panel's idiom).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { CloseIcon } from "./icons";

const NARROW_QUERY = "(max-width: 1099px)";
/** Where the panel sticks: its `top-[100px]`. */
const STICKY_TOP = 100;
/** The app's Forge button sits fixed 24 px from the window's bottom and is 48 px tall; the panel stops 12 px above it. */
const FORGE_CLEARANCE = 84;
const MIN_HEIGHT = 240;

/**
 * For the grid the panel sits in beside the page: at least as tall as the
 * panel can be. A shorter page would otherwise end where the panel ends, and
 * the panel would measure itself as the grid's end.
 */
export const BESIDE_GRID_STYLE: CSSProperties = { minHeight: `calc(100vh - ${STICKY_TOP + FORGE_CLEARANCE}px)` };

function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia?.(NARROW_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

/** True below 1100 px. False on the server, and wherever `matchMedia` is missing. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia?.(NARROW_QUERY).matches ?? false,
    () => false,
  );
}

interface SidePanelProps {
  id: string;
  title: string;
  open: boolean;
  /** Draw the panel over the page (narrow screens) instead of beside it. */
  overlay: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Pinned under the part that scrolls (the chat composer). */
  footer?: ReactNode;
}

export function SidePanel({ id, title, open, overlay, onOpenChange, children, footer }: SidePanelProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  const drawer = open && overlay;
  const beside = open && !overlay;
  useBodyScrollLock(drawer);

  // Beside the page, the panel ends above the Forge button, so its composer stays
  // in view: its height runs from where its top is now (lower until the page
  // scrolls it up to its sticky line) to the window's bottom. Near the page's
  // end the grid it sits in (BESIDE_GRID_STYLE) ends first, and a sticky box
  // can't leave its grid: the panel then ends with the grid, so the grid's end
  // never pushes it up under the app's header. Scrolls are caught on the way
  // down, so a pane that scrolls on its own counts too. The class's max-height
  // holds until the first measure.
  useLayoutEffect(() => {
    if (!beside) return;
    function fit() {
      const aside = asideRef.current;
      const top = Math.max(aside?.getBoundingClientRect().top ?? STICKY_TOP, STICKY_TOP);
      const gridBottom = aside?.parentElement?.getBoundingClientRect().bottom ?? Infinity;
      const bottom = Math.min(window.innerHeight - FORGE_CLEARANCE, gridBottom);
      setMaxHeight(Math.max(MIN_HEIGHT, bottom - top));
    }
    fit();
    window.addEventListener("scroll", fit, { capture: true, passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit, { capture: true });
      window.removeEventListener("resize", fit);
    };
  }, [beside]);

  // The drawer takes focus, closes on Escape, and hands focus back to whatever opened it.
  useEffect(() => {
    if (!drawer) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surfaceRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [drawer, onOpenChange]);

  if (!open) return null;

  const header = (
    <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        aria-label={`Hide ${title.toLowerCase()}`}
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair-2 text-ink-3 transition-colors duration-150 hover:border-hair-3 hover:text-ink"
      >
        <CloseIcon />
      </button>
    </div>
  );
  const body = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0">{footer}</div>}
    </>
  );

  if (drawer) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end">
        <div onClick={() => onOpenChange(false)} className="absolute inset-0 bg-paper/70" />
        <div
          ref={surfaceRef}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="relative z-10 flex h-full w-full flex-col border-l border-hair-2 bg-card-2 outline-none sm:w-[420px]"
        >
          {header}
          {body}
        </div>
      </div>
    );
  }

  return (
    <aside
      ref={asideRef}
      id={id}
      aria-label={title}
      style={{ maxHeight }}
      className="sticky top-[100px] flex max-h-[calc(100vh-120px)] flex-col rounded border border-hair bg-card"
    >
      {header}
      {body}
    </aside>
  );
}
