"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type OverflowMenuItem = {
  label: string;
  disabled?: boolean;
  /** "destructive" = crit-colored (e.g. Unlink, Remove). Defaults to "default". */
  variant?: "default" | "destructive";
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: () => void });

const ITEM_CLASS: Record<"default" | "destructive", string> = {
  default:
    "block w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-card-2 hover:text-ink disabled:opacity-50",
  destructive:
    "block w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-crit transition-colors hover:bg-crit/10 disabled:opacity-50",
};

/**
 * Shared "⋯" overflow menu — kebab trigger + role="menu" dropdown, with
 * click-outside and Escape to close. Extracted from two near-identical
 * copies (RelationshipCard in crm-household-relationships-section.tsx and
 * the family-card menu in contacts-tab.tsx) so the interaction logic lives
 * in one place. Each item is either a Link (href) or a button (onClick).
 */
export function OverflowMenu({
  triggerLabel,
  items,
  minWidthClassName = "min-w-[140px]",
}: {
  /** aria-label for the "⋯" trigger button — callers vary this per-row
   *  ("Actions for {name}") or keep it static ("More actions"). */
  triggerLabel: string;
  items: OverflowMenuItem[];
  /** Preserves each call site's original dropdown width. */
  minWidthClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-card-2 hover:text-ink"
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full z-30 mt-1.5 ${minWidthClassName} rounded-[var(--radius-sm)] border border-hair bg-paper p-1 shadow-lg`}
        >
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={ITEM_CLASS[item.variant ?? "default"]}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className={ITEM_CLASS[item.variant ?? "default"]}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
