"use client";

import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import {
  START_PATHS,
  PathCard,
  type StartPath,
} from "@/components/planning-start-paths";

/**
 * Shown over `/crm/new` the moment a household is created, so an advisor who
 * meant to start planning doesn't have to detour through the CRM record and
 * find the "Start planning" button.
 *
 * Routes only — the planning client is still created by `/clients/new`, which
 * owns the payload defaults and the post-create destinations. Every exit uses
 * `router.replace` so the spent create form leaves no back-stack entry.
 */
export function StartPlanningPrompt({
  household,
}: {
  household: { id: string; name: string };
}) {
  const router = useRouter();

  function dismiss() {
    router.replace(`/crm/households/${household.id}`);
  }

  function choose(path: StartPath) {
    router.replace(`/clients/new?crmHouseholdId=${household.id}&path=${path}`);
  }

  return (
    <DialogShell
      open
      // Esc, the backdrop, and the header X come through here; the footer
      // button comes through secondaryAction. Both must dismiss the same way.
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
      title="Household created"
      size="md"
      secondaryAction={{ label: "Not now", onClick: dismiss }}
    >
      <p className="text-[14px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">{household.name}</span> is saved.
        Want to set up their plan now?
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {START_PATHS.map((p) => (
          <PathCard
            key={p.id}
            icon={p.icon}
            title={p.title}
            subtitle={p.subtitle}
            onSelect={() => choose(p.id)}
          />
        ))}
      </div>

      <p className="mt-4 text-[12px] text-ink-4">
        You can start planning any time from the household record.
      </p>
    </DialogShell>
  );
}
