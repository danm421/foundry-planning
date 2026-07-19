"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StateSelect } from "@/components/state-select";
import DialogShell from "@/components/dialog-shell";
import TabAutoSaveIndicator from "@/components/tab-auto-save-indicator";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
} from "@/components/forms/input-styles";
import type { DivorceDraftSettings } from "@/lib/divorce/schemas";

/** The spouse's post-split file can never be "married" — so both sides pick
 *  from the same narrowed pair the PATCH schema accepts. */
type SplitFilingStatus = "single" | "head_of_household";
const FILING_STATUS_OPTIONS: Array<{ value: SplitFilingStatus; label: string }> = [
  { value: "single", label: "Single" },
  { value: "head_of_household", label: "Head of household" },
];

export interface SettingsRailProps {
  clientId: string;
  splitYear: number;
  primaryFilingStatus: SplitFilingStatus;
  spouseFilingStatus: SplitFilingStatus;
  spouseState: string | null;
  people: { primaryName: string; spouseName: string };
  /** Whether the debounced settings PATCH is in flight / errored (owned by the
   *  workbench shell). Renders a quiet inline status. */
  saveStatus: "idle" | "saving" | "error";
  /** Clear a surfaced save error (the shell resets saveStatus to idle). */
  onDismissSaveError: () => void;
  /** Fire a partial settings patch upward; the shell debounces + PATCHes. */
  onChange: (patch: DivorceDraftSettings) => void;
}

export function SettingsRail({
  clientId,
  splitYear,
  primaryFilingStatus,
  spouseFilingStatus,
  spouseState,
  people,
  saveStatus,
  onDismissSaveError,
  onChange,
}: SettingsRailProps) {
  const router = useRouter();

  // Split year is echoed from a local string so mid-typing values (e.g. "202")
  // render without the controlled prop snapping the field back; only a valid,
  // in-range year (matching the PATCH schema's 2020–2100 bound) propagates up.
  const [yearText, setYearText] = useState(String(splitYear));
  useEffect(() => setYearText(String(splitYear)), [splitYear]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [abandonError, setAbandonError] = useState<string | null>(null);

  const primaryLabel = people.primaryName || "Primary";
  const spouseLabel = people.spouseName || "Spouse";

  async function abandon() {
    setAbandoning(true);
    setAbandonError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/divorce-plan/abandon`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Abandon failed (${res.status})`);
      // Draft is gone — a GET now 404s, so leave the workbench for the client
      // overview rather than re-rendering an empty shell.
      router.push(`/clients/${clientId}/overview`);
    } catch (err) {
      setAbandonError(err instanceof Error ? err.message : "Abandon failed");
      setAbandoning(false);
    }
  }

  return (
    <aside className="flex w-full flex-col rounded-[var(--radius)] border border-hair bg-card p-5 lg:min-h-0 lg:overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">
          Split settings
        </h2>
        <TabAutoSaveIndicator
          saving={saveStatus === "saving"}
          error={saveStatus === "error" ? "Save failed" : null}
          onDismissError={onDismissSaveError}
        />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {/* Split year */}
        <div>
          <label htmlFor="divorce-split-year" className={fieldLabelClassName}>
            <span className="inline-flex items-center gap-1.5">
              Split year
              <FieldTooltip text="The calendar year the household separates. Each side's post-split file and projection start here." />
            </span>
          </label>
          <input
            id="divorce-split-year"
            type="number"
            inputMode="numeric"
            min={2020}
            max={2100}
            value={yearText}
            onChange={(e) => {
              const raw = e.target.value;
              setYearText(raw);
              const n = Number(raw);
              if (Number.isInteger(n) && n >= 2020 && n <= 2100) {
                onChange({ splitYear: n });
              }
            }}
            className={`${inputClassName} tabular`}
          />
        </div>

        {/* Per-side filing status */}
        <div>
          <label htmlFor="divorce-primary-filing" className={fieldLabelClassName}>
            Filing status — {primaryLabel}
          </label>
          <select
            id="divorce-primary-filing"
            value={primaryFilingStatus}
            onChange={(e) =>
              onChange({ primaryFilingStatus: e.target.value as SplitFilingStatus })
            }
            className={selectClassName}
          >
            {FILING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="divorce-spouse-filing" className={fieldLabelClassName}>
            Filing status — {spouseLabel}
          </label>
          <select
            id="divorce-spouse-filing"
            value={spouseFilingStatus}
            onChange={(e) =>
              onChange({ spouseFilingStatus: e.target.value as SplitFilingStatus })
            }
            className={selectClassName}
          >
            {FILING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Spouse residence state */}
        <div>
          <label htmlFor="divorce-spouse-state" className={fieldLabelClassName}>
            <span className="inline-flex items-center gap-1.5">
              {spouseLabel} residence state
              <FieldTooltip text="Where the departing spouse's new household files. Defaults to the current household state; clear to fall back to it." />
            </span>
          </label>
          <StateSelect
            id="divorce-spouse-state"
            name="spouseState"
            value={spouseState ?? ""}
            onChange={(v) =>
              // StateSelect only emits a valid USPS code or "" (its placeholder);
              // "" clears the override back to the household state (null).
              onChange({
                spouseState:
                  v === ""
                    ? null
                    : (v as NonNullable<DivorceDraftSettings["spouseState"]>),
              })
            }
          />
        </div>
      </div>

      <div className="mt-6 border-t border-hair pt-4">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="text-[13px] font-medium text-crit transition-colors hover:text-crit/80"
        >
          Abandon plan
        </button>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-4">
          Discards this draft. Nothing in the live plan changes.
        </p>
      </div>

      <DialogShell
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!abandoning) setConfirmOpen(o);
        }}
        title="Abandon divorce plan?"
        size="sm"
        destructiveAction={{
          label: "Abandon plan",
          onClick: abandon,
          loading: abandoning,
        }}
        secondaryAction={{
          label: "Keep editing",
          onClick: () => setConfirmOpen(false),
          disabled: abandoning,
        }}
      >
        <p className="text-[14px] leading-relaxed text-ink-2">
          This discards the draft and its allocation decisions. It does not
          change the live household — nothing has been committed yet.
        </p>
        {abandonError ? (
          <p className="mt-3 text-[13px] text-crit">{abandonError}</p>
        ) : null}
      </DialogShell>
    </aside>
  );
}
