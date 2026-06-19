"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: string;
  dateOfBirth: string | null;
};

interface Props {
  rows: Row[];
  editEnabled: boolean;
}

const EMPTY_DRAFT: Omit<Row, "id"> = {
  firstName: "",
  lastName: "",
  relationship: "child",
  dateOfBirth: null,
};

export default function ProfileFamilyList({
  rows,
  editEnabled,
}: Props): ReactElement {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/portal/family", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({ error: "Failed to add" }))).error);
        return;
      }
      setAdding(false);
      setDraft(EMPTY_DRAFT);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function update(id: string, patch: Partial<Row>) {
    setError(null);
    const res = await fetch(`/api/portal/family/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: "Failed to update" }))).error);
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this family member?")) return;
    setError(null);
    const res = await fetch(`/api/portal/family/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete family member");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 text-[12px] text-bad">{error}</p>}
      <header className="flex items-center justify-between mb-3">
        <h1 className="text-[18px] font-semibold text-ink">Family</h1>
        {editEnabled && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent"
          >
            + Add
          </button>
        )}
      </header>

      {rows.length === 0 && !adding && (
        <p className="text-[13px] text-ink-3">No family members yet.</p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-hair rounded-md border border-hair bg-paper">
          {rows.map((r) => (
            <li key={r.id} className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[14px] text-ink">
                  {r.firstName} {r.lastName ?? ""}
                </div>
                <div className="text-[12px] text-ink-3">
                  {r.relationship}
                  {r.dateOfBirth ? ` · DOB ${r.dateOfBirth}` : ""}
                </div>
              </div>
              {editEnabled && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const newName = prompt("First name", r.firstName);
                      if (newName && newName !== r.firstName) {
                        void update(r.id, { firstName: newName });
                      }
                    }}
                    className="text-[12px] text-ink-2 hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    className="text-[12px] text-bad hover:underline"
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 rounded-md border border-hair bg-card-2 p-3 space-y-2">
          <input
            type="text"
            placeholder="First name"
            value={draft.firstName}
            onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
            className="w-full rounded-md border border-hair bg-paper px-3 py-1.5 text-[13px]"
          />
          <input
            type="text"
            placeholder="Last name"
            value={draft.lastName ?? ""}
            onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
            className="w-full rounded-md border border-hair bg-paper px-3 py-1.5 text-[13px]"
          />
          <select
            value={draft.relationship}
            onChange={(e) => setDraft({ ...draft, relationship: e.target.value })}
            className="w-full rounded-md border border-hair bg-paper px-3 py-1.5 text-[13px]"
          >
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="sibling">Sibling</option>
            <option value="other">Other</option>
          </select>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
              }}
              className="rounded-md border border-hair px-3 py-1.5 text-[13px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !draft.firstName}
              className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
