"use client";

import { useEffect, useRef, useState } from "react";
import { fieldLabelClassName, textareaClassName } from "@/components/forms/input-styles";
import type { BusinessAccount } from "./types";

export interface BusinessNotesTabProps {
  clientId: string;
  business: BusinessAccount;
  hidden: boolean;
}

export default function BusinessNotesTab({ clientId, business, hidden }: BusinessNotesTabProps) {
  // Derived-state reset: track which business id owns the current notes value.
  const [notes, setNotes] = useState(business.notes ?? "");
  const [ownedById, setOwnedById] = useState(business.id);
  const [savingError, setSavingError] = useState<string | null>(null);
  const savedRef = useRef(business.notes ?? "");

  // When the business switches, reset notes synchronously in render (derived state pattern).
  // savedRef is updated in a layout effect so it stays in sync after the reset render.
  if (business.id !== ownedById) {
    const fresh = business.notes ?? "";
    setNotes(fresh);
    setOwnedById(business.id);
  }

  useEffect(() => {
    savedRef.current = business.notes ?? "";
  }, [business.id, business.notes]);

  async function persist() {
    if (notes === savedRef.current) return;
    setSavingError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/accounts/${business.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSavingError(json.error ?? "Failed to save notes");
        return;
      }
      savedRef.current = notes;
    } catch (e) {
      setSavingError(e instanceof Error ? e.message : "Failed to save notes");
    }
  }

  return (
    <div className={hidden ? "hidden" : "space-y-2"}>
      {savingError && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{savingError}</p>
      )}
      <label htmlFor="biz-notes" className={fieldLabelClassName}>Notes</label>
      <textarea
        id="biz-notes"
        rows={10}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={persist}
        className={textareaClassName}
        placeholder="Notes about this business…"
      />
    </div>
  );
}
