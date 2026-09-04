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
import { SectionLabel, addGhostClass } from "@/components/crm-section-primitives";

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
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
      <section aria-labelledby="activity-feed-heading" className="flex flex-col gap-4">
        <SectionLabel id="activity-feed-heading" segments={["Activity", "History"]} />
        <CrmActivityFeed householdId={household.id} handleRef={feedRef} />
      </section>

      <section
        aria-labelledby="activity-log-heading"
        className="flex flex-col gap-4 lg:sticky lg:top-4"
      >
        <SectionLabel id="activity-log-heading" as="h3" segments={["Log"]} />
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-hair-2 bg-card p-4">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.kind}
              type="button"
              onClick={() => openWith(a.kind)}
              className={`${addGhostClass} w-full text-left hover:border-accent-deep`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </section>

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
