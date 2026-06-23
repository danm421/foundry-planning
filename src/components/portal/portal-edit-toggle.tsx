"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import PortalCard from "@/components/portal/portal-card";
import { PencilIcon } from "@/components/portal/portal-icons";

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
    <PortalCard
      icon={<PencilIcon />}
      title="Edit permission"
      description="When off, the client sees their profile and accounts but cannot change anything or link new accounts."
      action={
        <label className="inline-flex cursor-pointer items-center gap-2.5">
          <span className="text-[12px] text-ink-3">{enabled ? "Editing on" : "Editing off"}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Allow client to edit"
            checked={enabled}
            disabled={busy}
            onChange={(e) => flip(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-hair-2 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
        </label>
      }
    />
  );
}
