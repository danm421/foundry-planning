"use client";

// The estate dialog's charity pane. A charity is a two-field object — name and
// public/private — so the pane is the whole editor, with no tabs.
//
// An existing charity edits in place: every keystroke emits one full
// `external-beneficiary-upsert`, the same shape the trust editor uses, so the
// mutation map collapses a burst of typing into a single entry. A new charity
// is held locally until Add, because minting an id per keystroke would leave a
// trail of half-named charities in the working tree.

import { useState } from "react";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
} from "@/components/forms/input-styles";
import type { RailCharity } from "./solver-estate-rail";

type CharityType = "public" | "private";

interface Props {
  /** The charity to edit, or null to add one. */
  charity: RailCharity | null;
  onUpdate: (c: RailCharity) => void;
  onAdd: (name: string, charityType: CharityType) => void;
  onRemove: (id: string) => void;
  onCancelAdd: () => void;
}

/** Keyed on the charity id so selecting a different one remounts the form —
 *  without the key the fields keep the previous charity's values and write them
 *  onto the new one. */
export function SolverCharityEditor(props: Props) {
  return <CharityEditorBody key={props.charity?.id ?? "new"} {...props} />;
}

function CharityEditorBody({ charity, onUpdate, onAdd, onRemove, onCancelAdd }: Props) {
  const [form, setForm] = useState({
    name: charity?.name ?? "",
    charityType: charity?.charityType ?? ("public" as CharityType),
  });
  const { name, charityType } = form;

  function edit(patch: Partial<typeof form>) {
    const next = { ...form, ...patch };
    setForm(next);
    if (charity) onUpdate({ ...charity, ...next });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="solver-charity-name">
            Charity name
          </label>
          <input
            id="solver-charity-name"
            type="text"
            value={name}
            onChange={(e) => edit({ name: e.target.value })}
            placeholder="e.g., Red Cross"
            className={inputClassName}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="solver-charity-type">
            Type
          </label>
          <select
            id="solver-charity-type"
            value={charityType}
            onChange={(e) => edit({ charityType: e.target.value as CharityType })}
            className={selectClassName}
          >
            <option value="public">Public charity</option>
            <option value="private">Private foundation</option>
          </select>
        </div>

        <p className="text-[12px] text-ink-3">
          Charities are available as gift recipients and as trust beneficiaries
          throughout this scenario.
        </p>
      </div>

      <div className="flex justify-end gap-2 border-t border-hair px-5 py-3">
        {charity ? (
          <button
            type="button"
            onClick={() => onRemove(charity.id)}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium text-crit hover:bg-card-hover"
          >
            Remove charity
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onCancelAdd}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-card-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onAdd(name, charityType)}
              disabled={name.trim() === ""}
              className="rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
            >
              Add charity
            </button>
          </>
        )}
      </div>
    </div>
  );
}
