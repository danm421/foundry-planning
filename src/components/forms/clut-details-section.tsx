"use client";

import { useMemo } from "react";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { computeClutInceptionInterests } from "@/lib/entities/compute-clut-inception";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";

const TERM_TYPE_LABELS = {
  years: "Years (term certain)",
  single_life: "Single life",
  joint_life: "Joint life (last survivor)",
  shorter_of_years_or_life: "Shorter of years or life",
} as const;

interface ClutDetailsSectionProps {
  value: TrustSplitInterestInput;
  onChange: (next: TrustSplitInterestInput) => void;
  familyMembers: { id: string; firstName: string; dateOfBirth: string | null }[];
  charities: { id: string; name: string }[];
}

export default function ClutDetailsSection({
  value,
  onChange,
  familyMembers,
  charities,
}: ClutDetailsSectionProps) {
  const origin = value.origin ?? "new";
  const isNew = origin === "new";
  const showTermYears =
    value.termType === "years" || value.termType === "shorter_of_years_or_life";
  const showLife1 = value.termType !== "years";
  const showLife2 = value.termType === "joint_life";

  const ageAt = (memberId: string | undefined, year: number): number | undefined => {
    if (!memberId) return undefined;
    const m = familyMembers.find((f) => f.id === memberId);
    if (!m?.dateOfBirth) return undefined;
    return year - parseInt(m.dateOfBirth.slice(0, 4), 10);
  };

  const preview = useMemo(() => {
    try {
      return computeClutInceptionInterests({
        inceptionValue: value.inceptionValue,
        payoutType: value.payoutType,
        payoutPercent: value.payoutPercent,
        payoutAmount: value.payoutAmount,
        irc7520Rate: value.irc7520Rate,
        termType: value.termType,
        termYears: value.termYears,
        measuringLifeAge1: ageAt(value.measuringLife1Id, value.inceptionYear),
        measuringLifeAge2: ageAt(value.measuringLife2Id, value.inceptionYear),
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, familyMembers]);

  const termEndYear = useMemo(() => {
    if (value.termType === "years" && value.termYears) {
      return value.inceptionYear + value.termYears - 1;
    }
    return null;
  }, [value]);

  const set = <K extends keyof TrustSplitInterestInput>(
    k: K,
    v: TrustSplitInterestInput[K],
  ) => onChange({ ...value, [k]: v });

  const percentToDisplay = (decimal: number | undefined): string =>
    decimal == null ? "" : (decimal * 100).toString();
  const percentFromDisplay = (display: string): number => {
    const n = Number(display);
    return Number.isFinite(n) ? n / 100 : 0;
  };

  return (
    <fieldset className="rounded-md border border-hair p-4 space-y-3">
      <legend className="px-2 text-sm font-semibold text-ink">CLUT Details</legend>

      {/* Origin: new (funded in plan) vs existing (funded historically) */}
      <div className="space-y-1">
        <span className={fieldLabelClassName}>Trust origin</span>
        <div role="radiogroup" aria-label="Trust origin" className="flex gap-2">
          {(
            [
              ["new", "New (funded in plan)"],
              ["existing", "Existing (already funded)"],
            ] as const
          ).map(([val, label]) => {
            const active = origin === val;
            return (
              <button
                key={val}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set("origin", val)}
                className={
                  "rounded-md border px-3 py-1 text-xs font-medium transition-colors " +
                  (active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-hair bg-card text-ink-3 hover:border-hair-2 hover:text-ink-2")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-ink-3">
          {isNew
            ? "We'll compute the income and remainder interest from the inputs below and emit the remainder-interest gift on save."
            : "Enter the income and remainder interest values from the historical return. No fresh deduction or gift is emitted; we just project unitrust payments + termination forward."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelClassName} htmlFor="clut-inception-year">
            {isNew ? "Inception year" : "Original funding year"}
          </label>
          <input
            id="clut-inception-year"
            type="number"
            className={inputClassName}
            value={value.inceptionYear}
            onChange={(e) => set("inceptionYear", Number(e.target.value))}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="clut-fmv">
            {isNew ? "Funding-year FMV" : "FMV at original funding"}
          </label>
          <input
            id="clut-fmv"
            type="number"
            min={0}
            step={1}
            className={inputClassName}
            value={value.inceptionValue}
            onChange={(e) => set("inceptionValue", Number(e.target.value))}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="clut-payout">
            Payout percentage
          </label>
          <div className="relative">
            <input
              id="clut-payout"
              type="number"
              step="0.0001"
              min={0}
              max={100}
              className={`${inputClassName} pr-7`}
              value={percentToDisplay(value.payoutPercent)}
              onChange={(e) =>
                set("payoutPercent", percentFromDisplay(e.target.value))
              }
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
              %
            </span>
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="clut-7520">
            IRC §7520 rate
          </label>
          <div className="relative">
            <input
              id="clut-7520"
              type="number"
              step="0.001"
              min={0}
              max={100}
              className={`${inputClassName} pr-7`}
              value={percentToDisplay(value.irc7520Rate)}
              onChange={(e) =>
                set("irc7520Rate", percentFromDisplay(e.target.value))
              }
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
              %
            </span>
          </div>
          <p className="text-xs text-ink-3 mt-1">
            Locked at inception per Reg §1.7520-2.
          </p>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="clut-term-type">
            Term type
          </label>
          <select
            id="clut-term-type"
            className={selectClassName}
            value={value.termType}
            onChange={(e) =>
              set(
                "termType",
                e.target.value as TrustSplitInterestInput["termType"],
              )
            }
          >
            {Object.entries(TERM_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {showTermYears && (
          <div>
            <label className={fieldLabelClassName} htmlFor="clut-term-years">
              Term years
            </label>
            <input
              id="clut-term-years"
              type="number"
              min={1}
              className={inputClassName}
              value={value.termYears ?? ""}
              onChange={(e) =>
                set(
                  "termYears",
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          </div>
        )}

        {showLife1 && (
          <div>
            <label className={fieldLabelClassName} htmlFor="clut-life-1">
              Measuring life 1
            </label>
            <select
              id="clut-life-1"
              className={selectClassName}
              value={value.measuringLife1Id ?? ""}
              onChange={(e) =>
                set("measuringLife1Id", e.target.value || undefined)
              }
            >
              <option value="">— select —</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName}
                </option>
              ))}
            </select>
          </div>
        )}

        {showLife2 && (
          <div>
            <label className={fieldLabelClassName} htmlFor="clut-life-2">
              Measuring life 2
            </label>
            <select
              id="clut-life-2"
              className={selectClassName}
              value={value.measuringLife2Id ?? ""}
              onChange={(e) =>
                set("measuringLife2Id", e.target.value || undefined)
              }
            >
              <option value="">— select —</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="col-span-2">
          <label className={fieldLabelClassName} htmlFor="clut-charity">
            Charitable beneficiary
          </label>
          <select
            id="clut-charity"
            className={selectClassName}
            value={value.charityId ?? ""}
            onChange={(e) => set("charityId", e.target.value)}
          >
            <option value="">— select —</option>
            {charities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isNew ? (
        <div className="rounded-md bg-card-2 p-3 text-sm space-y-1">
          <div className="font-medium text-ink">Computed at inception</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <span className="text-ink-2">Income interest (charitable deduction)</span>
            <span data-testid="clut-income-interest" className="text-right font-mono">
              {preview ? `$${preview.originalIncomeInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </span>
            <span className="text-ink-2">Remainder interest (taxable gift)</span>
            <span data-testid="clut-remainder-interest" className="text-right font-mono">
              {preview ? `$${preview.originalRemainderInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </span>
            {termEndYear !== null && (
              <>
                <span className="text-ink-2">Term ends</span>
                <span className="text-right">{termEndYear}</span>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-md bg-card-2 p-3 space-y-3">
          <div className="text-sm font-medium text-ink">Historical values from the return</div>
          <p className="text-xs text-ink-3">
            Enter the values that were recorded when the CLUT was funded — they
            were calculated from the §7520 rate and mortality table in effect at
            that time.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabelClassName} htmlFor="clut-original-income">
                Income interest (deduction taken)
              </label>
              <input
                id="clut-original-income"
                type="number"
                min={0}
                step={1}
                className={inputClassName}
                value={value.originalIncomeInterest ?? ""}
                onChange={(e) =>
                  set(
                    "originalIncomeInterest",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="clut-original-remainder">
                Remainder interest (gift filed)
              </label>
              <input
                id="clut-original-remainder"
                type="number"
                min={0}
                step={1}
                className={inputClassName}
                value={value.originalRemainderInterest ?? ""}
                onChange={(e) =>
                  set(
                    "originalRemainderInterest",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
              />
            </div>
            {termEndYear !== null && (
              <div className="col-span-2 text-xs text-ink-3">
                Term ends {termEndYear} (based on original funding year + term).
              </div>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}
