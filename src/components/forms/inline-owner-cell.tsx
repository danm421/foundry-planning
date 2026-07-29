"use client";

// The owner cell on a details-page row.
//
// Ownership is a percentage-split relation, not an enum, so this cell is
// deliberately partial: it edits the presets it can round-trip and renders a
// read-only label for everything else. See `owner-presets.ts` for why, and for
// why `titlingType` always travels with `owners`.
import { InlineSelect, type InlineSelectItem } from "./inline-select";
import {
  ownerSelectValue,
  ownersFromSelectValue,
  type OwnerSelection,
  type OwnerTitling,
} from "@/lib/inline-edit/owner-presets";
import type { AccountOwner } from "@/engine/ownership";

export interface InlineOwnerCellProps {
  owners: AccountOwner[] | undefined;
  titlingType: OwnerTitling;
  /** Set when the row is a sub-asset of a business — ownership is inherited
   *  from the parent and is not this row's to change. */
  parentAccountId?: string | null;
  familyMembers: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  entities: { id: string; name: string }[];
  /** Retirement subTypes are single-owner by API rule, so the multi-owner
   *  presets must not appear. */
  retirementMode?: boolean;
  /** Current owner label, computed by the caller (it has the display helpers). */
  display: string;
  /** Lowercase noun phrase — "owner for Schwab Ind. Account". */
  label: string;
  canEdit: boolean;
  onSave: (next: OwnerSelection) => Promise<boolean>;
}

export default function InlineOwnerCell({
  owners,
  titlingType,
  parentAccountId,
  familyMembers,
  entities,
  retirementMode = false,
  display,
  label,
  canEdit,
  onSave,
}: InlineOwnerCellProps) {
  const clientId = familyMembers.find((f) => f.role === "client")?.id;
  const spouseId = familyMembers.find((f) => f.role === "spouse")?.id;

  const value =
    parentAccountId != null || owners == null
      ? null
      : ownerSelectValue(owners, clientId, spouseId, titlingType);

  // Read-only: a business sub-asset, a real split, a gifted-away holder, or no
  // ownership rows at all. A dropdown here would replace what it cannot show.
  if (!canEdit || value === null) {
    return <span className="truncate text-[11px] text-ink-3">{display}</span>;
  }

  const household: InlineSelectItem = {
    label: "Household",
    options: [
      ...(clientId
        ? [{ value: "client", label: familyMembers.find((f) => f.id === clientId)!.firstName }]
        : []),
      ...(spouseId
        ? [{ value: "spouse", label: familyMembers.find((f) => f.id === spouseId)!.firstName }]
        : []),
      ...(!retirementMode && clientId && spouseId
        ? [
            { value: "joint", label: "Joint" },
            { value: "community_property", label: "Community Property" },
          ]
        : []),
    ],
  };

  const others = familyMembers.filter((f) => f.id !== clientId && f.id !== spouseId);
  const options: InlineSelectItem[] = [household];
  if (others.length > 0) {
    options.push({
      label: "Family",
      options: others.map((f) => ({ value: `fm:${f.id}`, label: f.firstName })),
    });
  }
  if (entities.length > 0) {
    options.push({
      label: "Entity",
      options: entities.map((e) => ({ value: `ent:${e.id}`, label: e.name })),
    });
  }

  return (
    <InlineSelect
      display={display}
      value={value}
      options={options}
      label={label}
      canEdit
      className="truncate rounded-sm px-1 py-0.5 text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      onSelect={(raw) => {
        const next = ownersFromSelectValue(raw, clientId, spouseId);
        // null means the pick can't be built for this household (e.g. "joint"
        // with no spouse). Silently ignoring beats writing a broken array.
        if (next) void onSave(next);
      }}
    />
  );
}
