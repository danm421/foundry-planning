"use client";

import { useEffect, useRef, useState } from "react";

import type { FirmMember } from "@/lib/crm-tasks/members";
import { inputBaseClassName } from "@/components/forms/input-styles";

interface CrmTaskAssigneePickerProps {
  members: FirmMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Optional id so a `<label>` can be associated with the control. */
  id?: string;
  /** Optional disabled state — used while a parent save is in-flight. */
  disabled?: boolean;
}

/**
 * Simple click-to-open dropdown for assigning a firm member to a task.
 * Typeahead-style filter input at the top, "Unassigned" first item,
 * then matching members. No popover library — just an absolutely
 * positioned `<ul>` that closes on click-outside or escape.
 */
export function CrmTaskAssigneePicker({
  members,
  value,
  onChange,
  id,
  disabled,
}: CrmTaskAssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  function closeMenu() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = value ? members.find((m) => m.userId === value) ?? null : null;
  const buttonLabel = selected?.displayName ?? (value ?? "Unassigned");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? members.filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          (m.email?.toLowerCase().includes(q) ?? false),
      )
    : members;

  function pick(userId: string | null) {
    onChange(userId);
    closeMenu();
  }

  return (
    <div ref={wrapRef} className="relative inline-block w-full">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${inputBaseClassName} flex w-full items-center justify-between text-left`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? "text-ink" : "text-ink-3"}>{buttonLabel}</span>
        <span aria-hidden className="ml-2 text-ink-3">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card shadow-lg">
          <div className="border-b border-hair p-2">
            <input
              autoFocus
              type="search"
              placeholder="Filter members…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${inputBaseClassName} h-8 w-full text-[13px]`}
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
                className={
                  "block w-full px-3 py-1.5 text-left text-[13px] hover:bg-card-2 " +
                  (value === null ? "text-accent" : "text-ink-2")
                }
              >
                Unassigned
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-ink-3">No matches</li>
            ) : (
              filtered.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => pick(m.userId)}
                    className={
                      "block w-full px-3 py-1.5 text-left text-[13px] hover:bg-card-2 " +
                      (m.userId === value ? "text-accent" : "text-ink")
                    }
                  >
                    <span className="block truncate">{m.displayName}</span>
                    {m.email && (
                      <span className="block truncate text-[11px] text-ink-3">{m.email}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
