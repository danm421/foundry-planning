"use client";

import { useState } from "react";
import type { AccountCategory, AccountSubType } from "@/lib/extraction/types";
import { CATEGORY_OPTIONS, SUB_TYPE_OPTIONS } from "@/lib/accounts/category-labels";
import { selectClassName } from "@/components/forms/input-styles";

export interface AccountTypePatch {
  category?: AccountCategory;
  subType?: AccountSubType;
}

export interface AccountTypeCellEditProps {
  category?: AccountCategory;
  subType?: AccountSubType;
  /** Fires once, with BOTH values together, only when the advisor confirms. */
  onDone: (patch: AccountTypePatch) => void;
}

/**
 * The Account-type cell's edit view — the same two dropdowns
 * `review-step-accounts.tsx` uses, changed together (Task 10 review,
 * Important 2). Reclassifying can turn a row into (or out of) a 529, so a
 * partial write — closing after only the Category select fires — is worse
 * than useless: it applies half a classification change and reopening reads
 * back a `row` the parent may not have applied yet, silently reverting the
 * first edit.
 *
 * Holds both values in LOCAL state, seeded from props, and reports them to
 * the caller as one atomic patch only when "Done" is clicked — never on a
 * single select's `onChange`. This is also why it is its own component
 * rather than a factory function inlined in `accounts-columns.ts`: the two
 * drafts need somewhere to live between keystrokes, and a plain function
 * returning `ReactNode` has no hooks to hold them.
 */
export default function AccountTypeCellEdit({ category, subType, onDone }: AccountTypeCellEditProps) {
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftSubType, setDraftSubType] = useState(subType);

  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="Category"
        value={draftCategory ?? ""}
        className={selectClassName}
        onChange={(e) =>
          setDraftCategory((e.target.value || undefined) as AccountCategory | undefined)
        }
      >
        <option value="">Select...</option>
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Type"
        value={draftSubType ?? ""}
        className={selectClassName}
        onChange={(e) =>
          setDraftSubType((e.target.value || undefined) as AccountSubType | undefined)
        }
      >
        <option value="">Select...</option>
        {SUB_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onDone({ category: draftCategory, subType: draftSubType })}
        className="self-start rounded border border-hair px-2 py-0.5 text-xs text-accent hover:border-hair-2"
      >
        Done
      </button>
    </div>
  );
}
