"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_RE } from "@/lib/intake/schema";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { useClientTypeahead } from "@/hooks/use-client-typeahead";
import type { ClientSearchResult } from "@/lib/client-search";

/**
 * The Data Collection page's send card.
 *
 * Two recipient kinds, one request. A prospect send carries no clientId and
 * applies as a fresh household; an existing-client send carries the picked
 * clientId, and applyIntake merges the submission onto that client's base
 * scenario instead of creating a second household for someone already on the
 * roster.
 *
 * Both send the emailed blank form (`mode: "blank"`). Pre-filled sends are a
 * portal invite rather than a form link, so they stay on the client's own
 * Portal tab where the invite state is visible.
 */

const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-2 text-[14px] text-ink outline-none focus:border-accent";
const labelCls = "block mb-1 text-[12px] text-ink-3";

export default function SendIntakeForm() {
  const router = useRouter();
  const [recipientKind, setRecipientKind] = useState<"prospect" | "client">("prospect");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<ClientSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  function pickKind(kind: "prospect" | "client") {
    setRecipientKind(kind);
    setSelected(null);
    setError(null);
  }

  function pickClient(hit: ClientSearchResult) {
    setSelected(hit);
    setFirstName(hit.primaryFirstName);
    setLastName(hit.primaryLastName);
    // CRM contacts often carry no email — don't wipe a typed one to fill a gap.
    if (hit.primaryEmail) setEmail(hit.primaryEmail);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (recipientKind === "client" && !selected) {
      setError("Choose a client to send to.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "blank",
          ...(selected ? { clientId: selected.id } : {}),
          recipientName: `${firstName.trim()} ${lastName.trim()}`.trim(),
          recipientEmail: email,
        }),
      });

      if (res.status === 429) {
        setError("Rate limit reached. Please try again later.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to send intake form.");
        return;
      }

      setFirstName("");
      setLastName("");
      setEmail("");
      setSelected(null);
      setSuccess(true);
      router.refresh();
      setTimeout(() => setSuccess(false), 4000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">
          Send intake form
        </h2>
        <div className="flex items-center gap-1" role="group" aria-label="Recipient">
          <KindButton
            label="New prospect"
            active={recipientKind === "prospect"}
            onClick={() => pickKind("prospect")}
          />
          <KindButton
            label="Existing client"
            active={recipientKind === "client"}
            onClick={() => pickKind("client")}
          />
        </div>
      </div>

      {recipientKind === "client" && (
        <div className="mb-3">
          {selected ? (
            <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
              <span className="flex-1 truncate text-[14px] text-ink">{selected.householdTitle}</span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 text-[12px] text-accent hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <ClientPicker onPick={pickClient} />
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="recipient-first-name" className={labelCls}>
            First name
          </label>
          <input
            id="recipient-first-name"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jane"
            className={inputCls}
          />
        </div>
        <div className="flex-1">
          {/* The surname is the public link's second identity factor: the
              client types it with their email to unlock the form. Left blank,
              lib/intake/gate.ts::surnameCandidates has nothing to match and
              the link falls back to email alone. */}
          {/* Own class string, not `labelCls`: `flex` and that token's `block`
              are both display utilities, so which one wins is stylesheet order,
              not the order they're written here. */}
          <label
            htmlFor="recipient-last-name"
            className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-3"
          >
            Last name
            <FieldTooltip text="The client types this and their email to open the form link. Leave it blank and the link opens on email alone." />
          </label>
          <input
            id="recipient-last-name"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Smith"
            className={inputCls}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="recipient-email" className={labelCls}>
            Email <span aria-hidden="true">*</span>
          </label>
          <input
            id="recipient-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="btn-primary shrink-0 rounded-[var(--radius-sm)] bg-accent px-5 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>

      <p className="mt-2 text-[12px] text-ink-4">
        {recipientKind === "client"
          ? "Answers merge onto the client's existing plan when you apply the form."
          : "Answers create a new household when you apply the form."}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-crit">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-[13px] text-good">
          Intake form sent.
        </p>
      )}
    </div>
  );
}

function KindButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-[var(--radius-sm)] bg-accent-wash px-2.5 py-1 text-[12px] font-medium text-ink"
          : "rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-3 hover:text-ink"
      }
    >
      {label}
    </button>
  );
}

function ClientPicker({ onPick }: { onPick: (hit: ClientSearchResult) => void }) {
  const { query, setQuery, results, open, highlighted, setHighlighted, reopen, pick, handleKeyDown } =
    useClientTypeahead(onPick);

  return (
    <div className="relative">
      <label htmlFor="intake-client-search" className={labelCls}>
        Client
      </label>
      <input
        id="intake-client-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={reopen}
        placeholder="Search clients…"
        className={inputCls}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="intake-client-listbox"
      />
      {open ? (
        <ul
          id="intake-client-listbox"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-[var(--radius-sm)] border border-hair-2 bg-card-2"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-ink-4">No matches</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === highlighted}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`cursor-pointer px-3 py-2 text-[13px] ${
                  i === highlighted ? "bg-card-hover text-ink" : "text-ink-2"
                }`}
              >
                {r.householdTitle}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
