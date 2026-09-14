"use client";

import AssumedChip, { type ChipAssumption } from "@/components/import/assumed-chip";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

export interface OwnerCellProps {
  /** Resolved owner display name(s) — real people and entities from the plan. */
  names?: string[];
  /**
   * True when `names` came from a GUESS rather than a recorded fact: the coarse
   * `client|spouse|joint` enum the extractor inferred, rather than the
   * statement's registration line naming somebody on the roster or the advisor
   * picking. The names are still what would commit; the chip says nobody has
   * confirmed they are right.
   */
  assumed?: boolean;
  /** The registration name hint the statement itself printed, unconfirmed. */
  hint?: string;
  /** Coarse role recorded on the row — the last resort when nothing else is known. */
  role?: "client" | "spouse" | "joint";
}

/**
 * Why an owner is only an assumption. Exported because the editor shows it too —
 * `owner-cell-edit.tsx` — and one sentence in two files would drift.
 */
export const OWNER_HINT_REASON =
  "Inferred from the account registration, not confirmed — pick the owner to record it.";

const ROLE_LABELS: Record<"client" | "spouse" | "joint", string> = {
  client: "Client",
  spouse: CO_CLIENT_LABEL,
  joint: "Joint",
};

/**
 * Owner cell resolution order: resolved NAMES, then the coarse role as the value
 * with the printed registration name as subordinate context, then the name alone
 * when there is no role, then "—".
 *
 * Names lead because names are what the advisor recognises, and — since
 * `accounts-columns.ts` resolves the coarse enum through the household roster
 * too — a name is a strictly more accurate statement of what will commit than
 * the word "Client" ever was: `commit/accounts.ts` turns `owner: "client"` into
 * that very person via `synthesizeAccountOwners`. The role rungs below survive
 * for the case the roster cannot answer at all (no family members loaded yet, a
 * hint naming nobody on the plan).
 *
 * The "Assumed" pill marks a guess, and it now annotates the NAME rather than
 * the printed registration string, because the name is the thing being guessed
 * at. An advisor's explicit pick, or a registration line that actually matched
 * somebody, clears it — that is the difference between the two states, and the
 * old cell (where the pill stayed forever) could not show it.
 *
 * C5: `AssumedChip` marks itself with `data-testid="assumed-chip"`, not
 * `data-assumed` — this cell carries `data-assumed` itself on the guessed paths
 * rather than assuming the chip supplies it.
 */
export default function OwnerCell({ names, assumed, hint, role }: OwnerCellProps) {
  // `assumption` deliberately does not repeat the name in its reason string: it
  // would give a second element whose text also matches, which reads as
  // ambiguous to anything querying by that name (including this component's own
  // tests).
  const assumption = (value: string): ChipAssumption => ({
    field: "owner",
    value,
    reason: OWNER_HINT_REASON,
  });

  /*
    No tooltip on this pill (fix round 1, Important 1). This cell is
    click-to-edit, so `entity-table.tsx` wraps everything here in a
    `<button>`, and `FieldTooltip` is itself a button — nested interactive
    content, whose inner click would bubble out and open the editor instead.
    The pill STAYS: it is the at-a-glance signal for which owner values are
    guesses, which an editable cell needs more, not less. `reason` lives in
    the editor, which is where the advisor can act on it.
  */
  if (names && names.length > 0) {
    const joined = names.join(" & ");
    if (!assumed) return <span className="text-ink">{joined}</span>;
    // Two parts, value first: the resolved names in primary ink, the printed
    // registration line beneath them one step down the type scale as the
    // evidence. Stacked rather than inline so a long registration name cannot
    // push the column wide, and so the read state mirrors the editor.
    // `data-assumed` wraps BOTH halves: the guess is the whole reading — these
    // names, from that registration line — so a query landing on either one
    // must find the marker.
    return (
      <span data-assumed="true" className="inline-flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink">{joined}</span>
          <AssumedChip assumption={assumption(joined)} withTooltip={false} />
        </span>
        {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      </span>
    );
  }

  const printedName = hint ? (
    <span className="inline-flex items-center gap-1.5">
      <span data-assumed="true" className="text-ink-3">
        {hint}
      </span>
      <AssumedChip assumption={assumption(hint)} withTooltip={false} />
    </span>
  ) : null;

  if (role) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="text-ink">{ROLE_LABELS[role]}</span>
        {printedName ? <span className="text-xs">{printedName}</span> : null}
      </span>
    );
  }

  // A printed name with no role at all — unchanged from before.
  if (printedName) return printedName;

  return <span className="text-ink-4">—</span>;
}
