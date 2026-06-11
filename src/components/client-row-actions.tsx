"use client";

import Link from "next/link";

interface ClientRowActionsProps {
  householdId: string;
  /** The linked planning client, or null when no plan exists yet. */
  planningClientId: string | null;
}

const pill =
  "inline-flex items-center rounded-md border border-transparent bg-card-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent";

/**
 * One-click navigation pills for a household row — bridges the two detail
 * areas without the old name-anchored popover. "CRM" always opens CRM detail;
 * "Planning" opens the existing plan, or deep-links into the quick-create
 * wizard with the household pre-selected when no plan exists yet.
 *
 * Each click records the open server-side (fire-and-forget, `keepalive` so it
 * survives the navigation) to power the "Recently opened" filter.
 */
export function ClientRowActions({
  householdId,
  planningClientId,
}: ClientRowActionsProps) {
  const recordOpen = () => {
    void fetch(`/api/crm/households/${householdId}/open`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <div className="flex gap-1.5">
      <Link
        href={`/crm/households/${householdId}`}
        className={pill}
        onClick={recordOpen}
      >
        CRM
      </Link>
      {planningClientId ? (
        <Link
          href={`/clients/${planningClientId}/details`}
          className={pill}
          onClick={recordOpen}
        >
          Planning
        </Link>
      ) : (
        <Link
          href={`/clients/new?crmHouseholdId=${householdId}`}
          className={pill}
          onClick={recordOpen}
        >
          Start planning
        </Link>
      )}
    </div>
  );
}
