"use client";

import { useRef, useState } from "react";
import type { getCrmHousehold } from "@/lib/crm/households";
import {
  CrmActivityFeed,
  type ActivityFeedHandle,
} from "@/components/crm-activity-feed";
import {
  CrmActivityEntryForm,
  type CrmActivityKind,
} from "@/components/crm-activity-entry-form";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

const QUICK_ACTIONS: { kind: CrmActivityKind; label: string }[] = [
  { kind: "call", label: "Log a call" },
  { kind: "note", label: "Add a note" },
  { kind: "meeting", label: "Log a meeting" },
  { kind: "email", label: "Log an email" },
];

export function ActivityTab({ household }: { household: Household }) {
  const [formOpen, setFormOpen] = useState(false);
  const [defaultKind, setDefaultKind] = useState<CrmActivityKind>("note");
  const feedRef = useRef<ActivityFeedHandle | null>(null);

  function openWith(kind: CrmActivityKind) {
    setDefaultKind(kind);
    setFormOpen(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => openWith(a.kind)}
            className="rounded-[var(--radius-sm)] border border-hair bg-card px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-accent/60 hover:bg-accent/10 hover:text-ink"
          >
            {a.label}
          </button>
        ))}
      </div>

      <CrmActivityFeed householdId={household.id} handleRef={feedRef} />

      <CrmActivityEntryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        householdId={household.id}
        defaultKind={defaultKind}
        onSaved={() => feedRef.current?.reload()}
      />
    </div>
  );
}
