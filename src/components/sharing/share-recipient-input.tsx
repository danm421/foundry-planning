"use client";

import { useId, useState } from "react";

import type { FirmMember } from "@/lib/crm-tasks/members";

type PickableMember = FirmMember & { email: string };

interface Props {
  id?: string;
  value: string;
  onChange: (email: string) => void;
  /** Firm members offered as picks. Anyone else can still be typed by email. */
  members: FirmMember[];
  /** Emails that already have access — not offered again. */
  excludeEmails?: string[];
  required?: boolean;
  /** Layout classes for the wrapper (width, flex). */
  className?: string;
  /** Styling for the input itself. */
  inputClassName?: string;
  /** Runs for keys the suggestion list did not consume. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

/**
 * Email field that suggests the caller's firm members as you focus or type.
 * Picking a member fills in their email; typing any other address still works,
 * so an advisor at another firm can be shared with the same way as before.
 */
export function ShareRecipientInput({
  id,
  value,
  onChange,
  members,
  excludeEmails = [],
  required,
  className = "",
  inputClassName = "",
  onKeyDown,
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const excluded = new Set(excludeEmails.map((e) => e.toLowerCase()));
  const pickable = members.filter(
    (m): m is PickableMember =>
      typeof m.email === "string" && m.email.includes("@") && !excluded.has(m.email.toLowerCase()),
  );
  const q = value.trim().toLowerCase();
  const matches = q
    ? pickable.filter(
        (m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
      )
    : pickable;
  const showList = open && matches.length > 0;

  function pick(m: PickableMember) {
    onChange(m.email);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showList) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" && active >= 0 && matches[active]) {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        // Close the list without closing an enclosing dialog.
        e.stopPropagation();
        setOpen(false);
        return;
      }
    } else if (e.key === "ArrowDown" && pickable.length > 0) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    onKeyDown?.(e);
  }

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type="email"
        required={required}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        placeholder={pickable.length > 0 ? "Name or email" : "advisor@otherfirm.com"}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          // While typing, Enter takes the best match.
          setActive(e.target.value.trim() ? 0 : -1);
        }}
        onFocus={() => setOpen(true)}
        // Reopens after Escape or a pick, while focus never left the field.
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className={inputClassName}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          // Keep focus in the input so the click lands before blur closes the list.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-sm)] border border-hair bg-card py-1 shadow-lg"
        >
          {matches.map((m, i) => (
            <li
              key={m.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => pick(m)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-card-2" : ""}`}
            >
              <span className="block truncate text-[13px] text-ink">{m.displayName}</span>
              <span className="block truncate text-[11px] text-ink-3">{m.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
