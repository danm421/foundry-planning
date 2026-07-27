"use client";

import { useState, useTransition } from "react";
import { SwitchControl } from "@/components/forms/switch-control";
import { setBookSiloEnabled } from "./actions";

interface Props {
  initial: boolean;
}

/**
 * Firm-wide book visibility. Off (legacy) means every org:member advisor
 * sees the whole firm's book; on means each advisor sees only their own
 * (plus anything shared with them). Admins always see the whole firm
 * either way, regardless of this setting.
 */
export default function BookSiloToggle({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  function flip(next: boolean) {
    const prev = enabled;
    setEnabled(next);
    setToast(null);
    startTransition(async () => {
      const result = await setBookSiloEnabled(next);
      if (!result.ok) {
        setEnabled(prev);
        setToast(result.error);
        return;
      }
      setToast("Saved");
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-hair p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Advisor book visibility</h2>
          <p className="text-sm text-ink-3">
            When on, each advisor sees only their own clients (plus anything shared
            with them). Admins always see the whole firm&apos;s book, either way.
          </p>
        </div>
        <SwitchControl
          checked={enabled}
          disabled={pending}
          ariaLabel="Silo each advisor to their own book"
          stateLabel={enabled ? "Per-advisor" : "Firm-wide"}
          onChange={flip}
        />
      </div>
      {toast ? <span className="text-sm text-ink-3">{toast}</span> : null}
    </div>
  );
}
