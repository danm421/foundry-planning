"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import type { ClientData, LtcEvent, ProjectionYear } from "@/engine/types";
import { LtcEventFields } from "./ltc-event-fields";

export function LtcEventDialog(props: {
  clientId: string;
  scenarioId: string;
  event: LtcEvent;
  tree: ClientData;
  projectionYears: ProjectionYear[];
  onDone(): void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<LtcEvent>(props.event);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // The changes route upserts a whole-event add; an `edit` is refused by design.
  async function save() {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(`/api/clients/${props.clientId}/scenarios/${props.scenarioId}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "add", targetKind: "ltc_event", entity: draft }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      props.onDone();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        if (!open) props.onDone();
      }}
      title="Long-term care event"
      size="md"
      primaryAction={{ label: "Save", onClick: () => void save(), loading: saving }}
    >
      <LtcEventFields event={draft} tree={props.tree} projectionYears={props.projectionYears} onChange={setDraft} />
      {error && (
        <p role="alert" className="mt-3 text-[12px] text-crit">
          Couldn&apos;t save. Try again.
        </p>
      )}
    </DialogShell>
  );
}
