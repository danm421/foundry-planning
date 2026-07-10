"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreIcon } from "./vault-icons";

export type RowMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

const MENU_W = 176;

/**
 * Kebab "⋯" trigger with a small action menu, portaled to <body> and
 * fixed-positioned off the trigger's rect so the list card's overflow-hidden
 * can't clip it (same approach as CategoryComboBox). Closes on outside click,
 * Escape, scroll, or resize.
 */
export function VaultRowMenu({
  items,
  label,
}: {
  items: RowMenuItem[];
  label: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const openMenu = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Right-align the menu to the trigger, clamped into the viewport.
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 220 && r.top > spaceBelow;
    setPos(openUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMove = () => close();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); openMenu(); }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-card-hover hover:text-ink"
      >
        <MoreIcon />
      </button>
      {open && pos &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="fixed inset-0 z-50 cursor-default"
            />
            <div
              role="menu"
              aria-label={label}
              className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-hair bg-card py-1 shadow-lg"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); close(); item.onSelect(); }}
                  className={`flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-card-2 ${
                    item.destructive ? "text-crit" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {item.icon && <span className={`shrink-0 ${item.destructive ? "text-crit" : "text-ink-3"}`}>{item.icon}</span>}
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
