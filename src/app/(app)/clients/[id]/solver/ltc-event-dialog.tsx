"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import type { ClientData, LtcEvent, ProjectionYear } from "@/engine/types";
import { LtcEventFields } from "./ltc-event-fields";
import { saveLtcEvent } from "./save-ltc-event";

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

  async function save() {
    setSaving(true);
    setError(false);
    try {
      await saveLtcEvent(props.clientId, props.scenarioId, draft);
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
