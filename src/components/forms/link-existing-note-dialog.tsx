"use client";

// Link-existing-note dialog: opens from the IDGT trust form's "Notes & sales"
// tab. The advisor picks an unlinked promissory note (subType === "promissory_note"
// and noteLinkedTrustEntityId is null) and links it to this trust as the debtor.
//
// PATCH /api/clients/[id]/accounts/[accountId] already accepts arbitrary
// account columns (mass-assignment-safe via the safeUpdate strip) — we send
// only the noteLinkedTrustEntityId.

import { useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import type { Entity } from "@/components/family-view";
import type { AssetsTabAccount } from "./assets-tab";
import { selectClassName, fieldLabelClassName } from "./input-styles";

interface Props {
  clientId: string;
  trust: Entity;
  accounts: AssetsTabAccount[];
}

/** Eligible notes: subType=promissory_note, not yet linked, family-owned. */
function isEligibleNote(a: AssetsTabAccount): boolean {
  if (a.subType !== "promissory_note") return false;
  if (a.noteLinkedTrustEntityId != null) return false;
  return a.owners.some((o) => o.kind === "family_member");
}

export default function LinkExistingNoteDialog({
  clientId,
  trust,
  accounts,
}: Props) {
  const [open, setOpen] = useState(false);
  const eligible = useMemo(() => accounts.filter(isEligibleNote), [accounts]);

  const [noteId, setNoteId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!noteId) return;
    setSaving(true);
    setError(null);
    try {
      // PATCH only updates ownerFamilyMemberId; use PUT to update arbitrary
      // account columns. The PUT handler strips identity/tenant fields, so
      // passing only noteLinkedTrustEntityId is the minimum-surface call.
      const res = await fetch(
        `/api/clients/${clientId}/accounts/${noteId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteLinkedTrustEntityId: trust.id }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      setNoteId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-ink-3 px-3 py-1.5 text-xs text-ink-2 hover:bg-paper"
      >
        Link an existing note
      </button>

      {open && (
        <DialogShell
          open
          onOpenChange={(o) => {
            if (!o) {
              setOpen(false);
              setNoteId("");
              setError(null);
            }
          }}
          title={`Link note to ${trust.name}`}
          size="md"
          primaryAction={{
            label: saving ? "Linking…" : "Link note",
            form: "link-existing-note-form",
            disabled: !noteId || saving,
            loading: saving,
          }}
        >
          <form
            id="link-existing-note-form"
            onSubmit={submit}
            className="flex flex-col gap-3"
          >
            <p className="text-[12px] text-ink-3">
              Marks the chosen note as a debt of this trust. The engine derives
              the trust&apos;s payment outflow from the note&apos;s terms.
            </p>

            <div>
              <label htmlFor="link-note" className={fieldLabelClassName}>
                Promissory note
              </label>
              {eligible.length === 0 ? (
                <p className="text-[12px] italic text-ink-4">
                  No unlinked family-owned promissory notes available.
                </p>
              ) : (
                <select
                  id="link-note"
                  value={noteId}
                  onChange={(e) => setNoteId(e.target.value)}
                  className={selectClassName}
                  required
                >
                  <option value="">— Select a note —</option>
                  {eligible.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} — balance ${n.value.toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
          </form>
        </DialogShell>
      )}
    </>
  );
}
