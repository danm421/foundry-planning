"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clientId: string;
  initialEnabled: boolean;
}

export default function PortalEditToggle({
  clientId,
  initialEnabled,
}: Props): ReactElement {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    setEnabled(next);
    const res = await fetch(`/api/clients/${clientId}/portal/edit-toggle`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setEnabled(!next); // revert
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-md border border-hair bg-paper p-5">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-[15px] font-medium text-ink">Edit permission</h3>
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => flip(e.target.checked)}
          />
          Allow client to edit
        </label>
      </header>
      <p className="text-[12px] text-ink-3">
        When off, the client sees their profile and accounts but cannot
        change anything or link new accounts.
      </p>
    </section>
  );
}
