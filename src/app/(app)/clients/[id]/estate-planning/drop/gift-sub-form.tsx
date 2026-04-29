"use client";

import { useState } from "react";
import type { Recipient } from "./lib/save-handlers";

export interface GiftSubFormProps {
  /** Owner's stake in the source account (fraction, 0-1). Informational only. */
  ownerSlicePct: number;
  /** Today's $ value of the owner's slice — drives the live preview. */
  ownerSliceValueAtToday: number;
  /** Annual growth rate used to project the live $ helper to the gift year. */
  growthRateForPreview: number;
  recipientKind: Recipient["kind"];
  /** Cash accounts gift a $ amount, not a % of the slice. */
  isCashAccount: boolean;
  onSubmit: (payload: GiftSubFormSubmit) => void;
  onCancel: () => void;
  /** Treated as the "current year" baseline for growth math + the year input minimum. */
  yearMin: number;
  /** Maximum year selectable. */
  yearMax: number;
}

export type GiftSubFormSubmit =
  | {
      kind: "one-time";
      year: number;
      yearRef?: string;
      /** (0, 1] — fraction of the owner's slice. Always emitted as a fraction. */
      sliceFraction: number;
      useCrummey: boolean;
      /** Optional cash override for cash-account gifts. */
      overrideAmount?: number;
      notes?: string;
    }
  | {
      kind: "recurring";
      startYear: number;
      endYear: number;
      annualAmount: number;
      inflationAdjust: boolean;
      useCrummey: boolean;
    };

const INPUT_CLASS =
  "block w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] px-2 py-1 text-sm text-[var(--color-ink)] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60";

export function GiftSubForm(props: GiftSubFormProps) {
  const isEntity = props.recipientKind === "entity";

  const [recurring, setRecurring] = useState(false);
  const [percent, setPercent] = useState(100);
  const [cashAmount, setCashAmount] = useState<number | "">("");
  const [year, setYear] = useState(props.yearMin);
  const [endYear, setEndYear] = useState(props.yearMax);
  const [annualAmount, setAnnualAmount] = useState(18_000);
  const [inflationAdjust, setInflationAdjust] = useState(false);
  const [crummey, setCrummey] = useState(false);
  const [notes, setNotes] = useState("");

  const yearsFromBase = Math.max(0, year - props.yearMin);
  const livePreview =
    !recurring && !props.isCashAccount
      ? props.ownerSliceValueAtToday *
        (percent / 100) *
        Math.pow(1 + props.growthRateForPreview, yearsFromBase)
      : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (recurring) {
      // Recurring requires entity recipient (audit finding #2). UI gates this,
      // but we belt-and-suspenders here too.
      if (!isEntity) return;
      if (!(annualAmount > 0)) return;
      props.onSubmit({
        kind: "recurring",
        startYear: year,
        endYear,
        annualAmount,
        inflationAdjust,
        useCrummey: crummey,
      });
      return;
    }

    if (props.isCashAccount) {
      const amt = typeof cashAmount === "number" ? cashAmount : NaN;
      if (!(amt > 0)) return;
      // For cash gifts the slice fraction defaults to "all of the cash you
      // typed" — the parent uses overrideAmount and ignores sliceFraction
      // when it routes to the cash-gift API. We still emit a valid (0, 1]
      // sentinel sliceFraction.
      props.onSubmit({
        kind: "one-time",
        year,
        sliceFraction: 1,
        overrideAmount: amt,
        useCrummey: crummey && isEntity,
        notes: notes || undefined,
      });
      return;
    }

    // One-time, asset-percent gift
    const fraction = percent / 100;
    if (!(fraction > 0) || fraction > 1) return; // audit finding #6
    props.onSubmit({
      kind: "one-time",
      year,
      sliceFraction: fraction,
      useCrummey: crummey && isEntity,
      notes: notes || undefined,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 p-3 text-sm text-[var(--color-ink)]"
    >
      <div className="flex items-center gap-2">
        <input
          id="gift-recurring"
          type="checkbox"
          checked={recurring}
          disabled={!isEntity}
          onChange={(e) => setRecurring(e.target.checked)}
        />
        <label htmlFor="gift-recurring" className="text-xs">
          Recurring annual gift{!isEntity ? " (entity recipient only)" : ""}
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="gift-year" className="text-xs text-[var(--color-ink-3)]">
          {recurring ? "Start year" : "Year"}
        </label>
        <input
          id="gift-year"
          type="number"
          min={props.yearMin}
          max={props.yearMax}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={INPUT_CLASS}
        />
      </div>

      {recurring && (
        <div className="flex flex-col gap-1">
          <label htmlFor="gift-end-year" className="text-xs text-[var(--color-ink-3)]">
            End year
          </label>
          <input
            id="gift-end-year"
            type="number"
            min={year}
            max={props.yearMax}
            value={endYear}
            onChange={(e) => setEndYear(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </div>
      )}

      {recurring ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="gift-annual" className="text-xs text-[var(--color-ink-3)]">
            Annual amount
          </label>
          <input
            id="gift-annual"
            type="number"
            min={1}
            step={1}
            required
            value={annualAmount}
            onChange={(e) => setAnnualAmount(Number(e.target.value))}
            className={INPUT_CLASS}
          />
          <div className="flex items-center gap-2">
            <input
              id="gift-inflation"
              type="checkbox"
              checked={inflationAdjust}
              onChange={(e) => setInflationAdjust(e.target.checked)}
            />
            <label htmlFor="gift-inflation" className="text-xs">
              Inflation-adjust each year
            </label>
          </div>
        </div>
      ) : props.isCashAccount ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="gift-cash" className="text-xs text-[var(--color-ink-3)]">
            Cash amount
          </label>
          <input
            id="gift-cash"
            type="number"
            min={0.01}
            step={0.01}
            value={cashAmount}
            onChange={(e) => {
              const v = e.target.value;
              setCashAmount(v === "" ? "" : Number(v));
            }}
            className={INPUT_CLASS}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="gift-percent"
            className="text-xs text-[var(--color-ink-3)]"
          >
            Percent of owner&rsquo;s slice
          </label>
          <input
            id="gift-percent"
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            readOnly={recurring}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className={INPUT_CLASS}
          />
          {livePreview !== null && (
            <p
              data-testid="gift-live-preview"
              className="text-xs text-[var(--color-ink-3)]"
            >
              {"≈ $"}
              {livePreview.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}{" "}
              at {year}
            </p>
          )}
        </div>
      )}

      {isEntity && (
        <div className="flex items-center gap-2">
          <input
            id="gift-crummey"
            type="checkbox"
            checked={crummey}
            onChange={(e) => setCrummey(e.target.checked)}
          />
          <label htmlFor="gift-crummey" className="text-xs">
            Use Crummey withdrawal powers
          </label>
        </div>
      )}

      {!recurring && (
        <div className="flex flex-col gap-1">
          <label htmlFor="gift-notes" className="text-xs text-[var(--color-ink-3)]">
            Notes
          </label>
          <input
            id="gift-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      )}

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
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-on hover:bg-accent-deep"
        >
          Save
        </button>
      </div>
    </form>
  );
}
