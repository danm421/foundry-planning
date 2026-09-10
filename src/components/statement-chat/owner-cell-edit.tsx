"use client";

import { selectClassName } from "@/components/forms/input-styles";

/** The coarse ownership enum `ExtractedAccount.owner` carries. */
export type OwnerRole = "client" | "spouse" | "joint";

const OWNER_OPTIONS: { value: OwnerRole; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

export interface OwnerCellEditProps {
  owner?: OwnerRole;
  /** The registration name the statement printed, verbatim. */
  hint?: string;
  /** Fires once, with the picked role. Never with `undefined` or `""`. */
  onDone: (owner: OwnerRole) => void;
}

/**
 * The Owner cell's edit view. `owner` is a `client | spouse | joint` enum the
 * EXTRACTOR guesses at a household role no statement prints, and Task 12
 * measured it flipping between two imports of the same files. It is no longer
 * a dedupe key — but it is still decisive at COMMIT: the statement-chat path
 * never seeds `row.owners`, so `commit/accounts.ts` writes ownership from
 * this enum via `synthesizeAccountOwners`. This control is what lets a human
 * correct the guess in one click before that happens.
 *
 * ONE field, so it writes on change and needs no local draft state and no
 * "Done" button — the opposite of `account-type-cell.tsx`, whose two selects
 * must move together or half a reclassification lands. Same reason it uses
 * the plain single-value `onChange(value)` path rather than a `fields: [...]`
 * fan-out.
 *
 * There is no way back to "unknown": the placeholder option is disabled, so
 * the enum can only ever be set to a value the domain check at
 * `tools.ts`'s `isValidFieldValue` accepts. Clearing it would write a value
 * that check rejects, and an owner the advisor has stated is better evidence
 * than the guess it replaced.
 *
 * The registration name sits on the canvas rather than in a `FieldTooltip`
 * because it is not a how-it-works explanation — it is the EVIDENCE the
 * advisor decides on, and the one owner field that stayed byte-identical
 * across all four of the imports whose guesses disagreed.
 */
export default function OwnerCellEdit({ owner, hint, onDone }: OwnerCellEditProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="Owner"
        value={owner ?? ""}
        className={selectClassName}
        onChange={(e) => {
          if (e.target.value) onDone(e.target.value as OwnerRole);
        }}
      >
        <option value="" disabled>
          Select...
        </option>
        {OWNER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className="text-xs text-ink-3">Statement reads “{hint}”</span> : null}
    </div>
  );
}
