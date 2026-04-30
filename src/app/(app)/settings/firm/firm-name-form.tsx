"use client";

import { useState, useTransition } from "react";
import { renameFirm } from "./actions";

interface Props {
  initial: string;
  firmId: string;
  isFounder: boolean;
}

export default function FirmNameForm({ initial, firmId, isFounder }: Props) {
  const [name, setName] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const dirty = name.trim() !== initial.trim();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await renameFirm(fd);
          if (!result.ok) {
            setToast(result.error);
            return;
          }
          if (result.noop) {
            setToast("No change");
            return;
          }
          if (result.divergenceWarning) {
            setToast("Saved — reports may show old name briefly");
            return;
          }
          setToast("Saved");
        });
      }}
    >
      {isFounder ? (
        <span className="inline-flex w-fit rounded bg-warn/10 px-2 py-0.5 text-xs text-warn">
          Founder firm
        </span>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        Firm display name
        <input
          name="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          className="rounded border border-hair bg-paper px-3 py-2 text-ink"
        />
      </label>
      <p className="text-xs text-ink-4">Firm ID: {firmId}</p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || pending}
          className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {toast ? <span className="text-sm text-ink-3">{toast}</span> : null}
      </div>
    </form>
  );
}
