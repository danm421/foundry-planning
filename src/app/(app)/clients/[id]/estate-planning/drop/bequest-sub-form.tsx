"use client";

import { useState } from "react";
import type { Recipient } from "./lib/save-handlers";

export interface BequestSubFormProps {
  /** Owner's stake in the asset (fraction 0-1) — informational only. */
  ownerSlicePct: number;
  /** When true, only "if_spouse_predeceased" is selectable. */
  isJointOrFractional: boolean;
  /** When false, the whose-will radios are hidden and grantorMode defaults to 'client'. */
  spouseAvailable: boolean;
  recipientKind: Recipient["kind"];
  onSubmit: (payload: {
    grantorMode: "client" | "spouse" | "both";
    /** (0, 1] — fraction of the owner's slice to bequeath. */
    sliceFraction: number;
    condition: "always" | "if_spouse_survives" | "if_spouse_predeceased";
  }) => void;
  onCancel: () => void;
}

type GrantorMode = "client" | "spouse" | "both";
type Condition = "always" | "if_spouse_survives" | "if_spouse_predeceased";

const INPUT_CLASS =
  "block w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] px-2 py-1 text-sm text-[var(--color-ink)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60";

export function BequestSubForm(props: BequestSubFormProps) {
  const [grantorMode, setGrantorMode] = useState<GrantorMode>("client");
  const [percent, setPercent] = useState(100);
  const [condition, setCondition] = useState<Condition>(
    props.isJointOrFractional ? "if_spouse_predeceased" : "always",
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fraction = percent / 100;
    if (!(fraction > 0) || fraction > 1) return; // audit finding #6
    props.onSubmit({
      grantorMode: props.spouseAvailable ? grantorMode : "client",
      sliceFraction: fraction,
      condition: props.isJointOrFractional ? "if_spouse_predeceased" : condition,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 p-3 text-sm text-[var(--color-ink)]"
    >
      {props.spouseAvailable && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs text-[var(--color-ink-3)]">Whose will</legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="grantor-mode"
              checked={grantorMode === "client"}
              onChange={() => setGrantorMode("client")}
            />
            Client&rsquo;s will
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="grantor-mode"
              checked={grantorMode === "spouse"}
              onChange={() => setGrantorMode("spouse")}
            />
            Spouse&rsquo;s will
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="grantor-mode"
              checked={grantorMode === "both"}
              onChange={() => setGrantorMode("both")}
            />
            Both (mirror)
          </label>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-[var(--color-ink-3)]">Condition</legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="bequest-condition"
            disabled={props.isJointOrFractional}
            checked={!props.isJointOrFractional && condition === "always"}
            onChange={() => setCondition("always")}
          />
          Always
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="bequest-condition"
            disabled={props.isJointOrFractional}
            checked={!props.isJointOrFractional && condition === "if_spouse_survives"}
            onChange={() => setCondition("if_spouse_survives")}
          />
          If spouse survives
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="bequest-condition"
            checked={
              props.isJointOrFractional || condition === "if_spouse_predeceased"
            }
            onChange={() => setCondition("if_spouse_predeceased")}
          />
          If spouse predeceased
        </label>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="bequest-percent" className="text-xs text-[var(--color-ink-3)]">
          Percent of owner&rsquo;s slice
        </label>
        <input
          id="bequest-percent"
          type="number"
          min={0.01}
          max={100}
          step={0.01}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md px-3 py-1 text-xs text-[var(--color-ink-3)] hover:bg-[var(--color-card-hover)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
        >
          Save
        </button>
      </div>
    </form>
  );
}
