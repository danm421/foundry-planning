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

/**
 * Why a registration name is only an assumption. Exported because the cell no
 * longer shows it — `owner-cell-edit.tsx` does, in the editor where the
 * advisor can act on it — and one sentence in two files would drift.
 */
export const OWNER_HINT_REASON =
  "Using the name exactly as the statement printed it — not yet matched to a family member.";

const ROLE_LABELS: Record<"client" | "spouse" | "joint", string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

/**
 * Owner cell resolution order: resolved `owners[]` names, then the coarse ROLE
 * as the value with the printed registration name as subordinate context, then
 * the name alone when there is no role, then "—".
 *
 * The role leads (fix round 2) because the role is what COMMITS. In the
 * statement-chat path `row.owners` is never seeded — `matchOwnersFromHint` is
 * the wizard's — so `commit/accounts.ts` falls through to
 * `synthesizeAccountOwners(tx, accountId, row.owner, …)` and writes household
 * ownership from the enum. The registration name is EVIDENCE for choosing that
 * enum, never the thing itself.
 *
 * The old order tested `hint` before `role`, so a printed name — essentially
 * always present — hid the role entirely. That was merely misleading while the
 * cell was read-only; it became a broken control the moment the cell was
 * editable, because picking "Spouse" changed nothing on screen and the
 * dropdown read as dead.
 *
 * The "Assumed" pill stays even after an explicit pick, and stays next to the
 * NAME rather than the role, because that is what it annotates:
 * `OWNER_HINT_REASON` says the printed name is not yet matched to a family
 * member, which is still true whatever role the advisor picks.
 *
 * C5: `AssumedChip` marks itself with `data-testid="assumed-chip"`, not
 * `data-assumed` — this cell carries `data-assumed` itself on the hint path
 * rather than assuming the chip supplies it.
 */
export default function OwnerCell({ names, hint, role }: OwnerCellProps) {
  if (names && names.length > 0) {
    return <span className="text-ink">{names.join(" & ")}</span>;
  }

  // `assumption` deliberately does not repeat `hint` in its reason string: it
  // would give a second element whose text also matches the printed name,
  // which reads as ambiguous to anything querying by that name (including
  // this component's own tests).
  const assumption: ChipAssumption | undefined = hint
    ? { field: "owner", value: hint, reason: OWNER_HINT_REASON }
    : undefined;

  /*
    No tooltip on this pill (fix round 1, Important 1). This cell is
    click-to-edit, so `entity-table.tsx` wraps everything here in a
    `<button>`, and `FieldTooltip` is itself a button — nested interactive
    content, whose inner click would bubble out and open the editor instead.
    The pill STAYS: it is the at-a-glance signal for which owner values are
    guesses, which an editable cell needs more, not less. `reason` lives in
    the editor, which is where the advisor can act on it.
  */
  const printedName = hint ? (
    <span className="inline-flex items-center gap-1.5">
      <span data-assumed="true" className="text-ink-3">
        {hint}
      </span>
      <AssumedChip assumption={assumption} withTooltip={false} />
    </span>
  ) : null;

  if (role) {
    // Two parts, value first: the role in primary ink, the evidence beneath it
    // one step down the type scale. Stacked rather than inline so a long
    // registration name cannot push the column wide, and so the read state
    // mirrors the editor, which stacks its select over the same name.
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="text-ink">{ROLE_LABELS[role]}</span>
        {printedName ? <span className="text-xs">{printedName}</span> : null}
      </span>
    );
  }

  // A printed name with no role at all — unchanged from before the reorder.
  if (printedName) return printedName;

  return <span className="text-ink-4">—</span>;
}
