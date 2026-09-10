"use client";

import AssumedChip, { type ChipAssumption } from "@/components/import/assumed-chip";

export interface OwnerCellProps {
  /** Resolved owner display name(s), when ownership matching has already run. */
  names?: string[];
  /** The registration name hint the statement itself printed, unconfirmed. */
  hint?: string;
  /** Coarse role recorded on the row — the last resort when nothing else is known. */
  role?: "client" | "spouse" | "joint";
}

const ROLE_LABELS: Record<"client" | "spouse" | "joint", string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

/**
 * Owner cell resolution order (brief + C5): resolved `owners[]` names, then
 * the registration hint wearing `AssumedChip`, then the coarse role word.
 *
 * C5: `AssumedChip` marks itself with `data-testid="assumed-chip"`, not
 * `data-assumed` — this cell carries `data-assumed` itself on the hint path
 * rather than assuming the chip supplies it.
 */
export default function OwnerCell({ names, hint, role }: OwnerCellProps) {
  if (names && names.length > 0) {
    return <span className="text-ink">{names.join(" & ")}</span>;
  }

  if (hint) {
    // Deliberately does not repeat `hint` in this string: the tooltip and
    // the visible hint text sit right next to each other, and the tooltip
    // is rendered in its own leaf node — echoing the hint here would give a
    // second element whose text also matches the printed name, which reads
    // as ambiguous to anything querying by that name (including this
    // component's own tests).
    const assumption: ChipAssumption = {
      field: "owner",
      value: hint,
      reason: "Using the name exactly as the statement printed it — not yet matched to a family member.",
    };
    return (
      <span className="inline-flex items-center gap-1.5">
        <span data-assumed="true" className="text-ink-3">
          {hint}
        </span>
        <AssumedChip assumption={assumption} />
      </span>
    );
  }

  if (role) {
    return <span className="text-ink-3">{ROLE_LABELS[role]}</span>;
  }

  return <span className="text-ink-4">—</span>;
}
