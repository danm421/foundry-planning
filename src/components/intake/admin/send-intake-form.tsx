"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_RE } from "@/lib/intake/schema";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { useClientTypeahead } from "@/hooks/use-client-typeahead";
import type { ClientSearchResult } from "@/lib/client-search";
import { SectionPicker } from "./section-picker";
import {
  forceFamilyForProspect,
  sectionsForForm,
  type IntakeSectionKey,
} from "@/lib/intake/sections";

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

// py-3 is not arbitrary: it matches `.btn-primary`'s own 0.75rem padding, so the
// inputs and the Send button end up the same height. That class lives unlayered
// in globals.css and outranks any Tailwind padding utility on the button, so the
// row has to be squared up from the input side.
const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-hair-2 focus:border-accent focus:ring-1 focus:ring-accent";
const labelCls = "mb-1.5 block text-[12px] font-medium text-ink-2";

export default function SendIntakeForm({
  defaultSections,
}: {
  /** The advisor's saved default, or null for the system default. Seeds the
   *  picker only — what gets stored is whatever is on screen when Send is
   *  pressed, so editing the saved default later never reshapes this form. */
  defaultSections: IntakeSectionKey[] | null;
}) {
  const router = useRouter();
  const [recipientKind, setRecipientKind] = useState<"prospect" | "client">("prospect");
  // Prospect is the initial kind, so seed through the same family rule the
  // create route enforces — the picker must never show a set it can't send.
  const [sections, setSections] = useState<IntakeSectionKey[]>(() =>
    forceFamilyForProspect(sectionsForForm(defaultSections), false),
  );
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
    // The create route forces Family into a prospect send. Do it here too so
    // the advisor sees the set that will actually be stored, rather than
    // discovering the difference on the review screen.
    if (kind === "prospect") setSections((s) => forceFamilyForProspect(s, false));
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
          sections,
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
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-hair bg-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-hair px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Send an intake form</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {recipientKind === "client"
              ? "Answers merge onto the client's existing plan when you apply the form."
              : "Answers create a new household when you apply the form."}
          </p>
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-hair bg-card-2 p-0.5"
          role="group"
          aria-label="Recipient"
        >
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

      <div className="px-5 py-5">
      {recipientKind === "client" && (
        <div className="mb-4">
          {selected ? (
            <>
              <span className={labelCls}>Client</span>
              <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2.5">
                <span className="flex-1 truncate text-[14px] text-ink">{selected.householdTitle}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 text-[12px] font-medium text-accent hover:underline"
                >
                  Change
                </button>
              </div>
            </>
          ) : (
            <ClientPicker onPick={pickClient} />
          )}
        </div>
      )}

      <div className="mb-5">
        <span className={labelCls}>Form steps</span>
        <SectionPicker
          value={sections}
          // Every set the picker emits goes through the prospect rule, not just
          // the ones `pickKind` produces: a preset chip replaces the whole set
          // outright, and "Documents only" would otherwise drop Family from a
          // prospect send — leaving it unchecked AND locked, with the create
          // route quietly putting it back at write time.
          onChange={(next) => setSections(forceFamilyForProspect(next, recipientKind === "client"))}
          familyLocked={recipientKind === "prospect"}
        />
      </div>

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
            className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-2"
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
          className="btn-primary shrink-0 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>

      {/* The steps ride in the URL rather than the saved default, so the
          advisor previews the form they are about to send, not the one they
          usually send. */}
      <a
        href={`/data-collection/preview?steps=${sections.join(",")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-[12px] text-ink-3 hover:text-ink hover:underline"
      >
        Preview this form
      </a>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-crit">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-3 text-[13px] text-good">
          Intake form sent.
        </p>
      )}
      </div>
    </section>
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
      className={`rounded-full px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "bg-accent-wash font-medium text-accent"
          : "text-ink-3 hover:text-ink"
      }`}
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
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-hair-2 bg-card-2 shadow-lg shadow-black/20"
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
