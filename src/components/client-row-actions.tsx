"use client";

import Link from "next/link";
import { postHouseholdOpen } from "@/lib/crm/record-open";

interface ClientRowActionsProps {
  householdId: string;
  /** The linked planning client, or null when no plan exists yet. */
  planningClientId: string | null;
}

/**
 * Secondary-button vocabulary, borrowed from `.btn-ghost`. Two things make
 * these read as targets rather than as data, and both are load-bearing:
 *
 *   · a HAIRLINE BORDER. `border-transparent` is what advisors reported as
 *     "nothing on this screen looks clickable".
 *   · a fill one step off the row. These sat on `bg-card-2` — which is exactly
 *     what the row hover used to swap in, so the pills dissolved into the row
 *     at the one moment someone was hunting for something to click. The row
 *     now hovers to `card-hover`, leaving `card-2` to mean "control".
 *
 * Measured border contrast vs the card: 1.73:1 dark · 1.42:1 light · 1.77:1
 * industrial — a hairline, per the brand. The fill offset and the border do
 * the work together; drop either and the pill reads as text again.
 */
const pill =
  "inline-flex items-center rounded-md border border-hair-2 bg-card-2 px-2.5 py-1 text-[13px] font-medium text-ink-2 " +
  "transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/**
 * One-click navigation pills for a household row — bridges the two detail
 * areas without the old name-anchored popover. "CRM" always opens CRM detail;
 * "Planning" opens the existing plan, or deep-links into the quick-create
 * wizard with the household pre-selected when no plan exists yet.
 *
 * They also NAME the destination, which the row's name link cannot: the name
 * is the big obvious target, these say where each side lives.
 */
export function ClientRowActions({
  householdId,
  planningClientId,
}: ClientRowActionsProps) {
  const recordOpen = () => postHouseholdOpen(householdId);

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
