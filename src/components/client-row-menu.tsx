"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface ClientRowMenuProps {
  householdId: string;
  /** Household display name — also the menu trigger label. */
  name: string;
  /** The linked planning client, or null when no plan exists yet. */
  planningClientId: string | null;
}

/**
 * Name-anchored popover for a household row. Bridges the two detail areas:
 * CRM detail (always) and the planning workspace (open existing, or start a
 * new plan via the quick-create wizard's pre-selected-household deep link).
 * Closes on click-outside or Escape — same pattern as crm-task-assignee-picker.
 */
export function ClientRowMenu({
  householdId,
  name,
  planningClientId,
}: ClientRowMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "block w-full px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-card-2 hover:text-ink";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="cursor-pointer font-medium text-accent transition-colors hover:text-accent-deep"
      >
        {name}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 min-w-44 overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card py-1 shadow-lg"
        >
          <Link
            role="menuitem"
            href={`/crm/households/${householdId}`}
            className={itemClass}
            onClick={close}
          >
            Open CRM
          </Link>
          {planningClientId ? (
            <Link
              role="menuitem"
              href={`/clients/${planningClientId}/overview`}
              className={itemClass}
              onClick={close}
            >
              Open planning
            </Link>
          ) : (
            <Link
              role="menuitem"
              href={`/clients/new?crmHouseholdId=${householdId}`}
              className={itemClass}
              onClick={close}
            >
              Start planning
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
