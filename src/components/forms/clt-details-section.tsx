"use client";

import { useMemo } from "react";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { computeCltInceptionInterests } from "@/lib/entities/compute-clt-inception";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import SplitInterestFundingPicker, {
  type SplitInterestFundingPickerAccount,
} from "./split-interest-funding-picker";
import type { SplitInterestFundingPick } from "@/lib/forms/split-interest-funding-diff";
import { FieldTooltip } from "./field-tooltip";

const TERM_TYPE_LABELS = {
  years: "Years (term certain)",
  single_life: "Single life",
  joint_life: "Joint life (last survivor)",
  shorter_of_years_or_life: "Shorter of years or life",
} as const;

interface CltDetailsSectionProps {
  value: TrustSplitInterestInput;
  onChange: (next: TrustSplitInterestInput) => void;
  familyMembers: { id: string; firstName: string; dateOfBirth: string | null }[];
  charities: { id: string; name: string }[];
  /** Required for origin === "new". Filtered list of accounts available for funding. */
  fundingAccounts?: SplitInterestFundingPickerAccount[];
  /** Required for origin === "new". Current picks. */
  fundingPicks?: SplitInterestFundingPick[];
  /** Required for origin === "new". Picks change handler. */
  onFundingPicksChange?: (next: SplitInterestFundingPick[]) => void;
  /** Default grantor for new cash picks (the trust's grantor). Defaults to "client". */
  defaultGrantor?: "client" | "spouse";
}

export default function CltDetailsSection({
  value,
  onChange,
  familyMembers,
  charities,
  fundingAccounts,
  fundingPicks,
  onFundingPicksChange,
  defaultGrantor,
}: CltDetailsSectionProps) {
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
      return computeCltInceptionInterests({
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
      <legend className="px-2 text-sm font-semibold text-ink">CLT Details</legend>

      {/* Origin: new (funded in plan) vs existing (funded historically) */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className={fieldLabelClassName}>Trust origin</span>
          <FieldTooltip text="New: we compute the income & remainder interest from the inputs below and emit the remainder-interest gift on save. Existing: enter the historical values from the return — no fresh deduction or gift is emitted, we just project payments and termination forward." />
        </div>
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
      </div>

      {/* Payment type: CLUT (unitrust — % of trust value) vs CLAT (annuity — fixed $) */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className={fieldLabelClassName}>Payment type</span>
          <FieldTooltip text="CLUT pays a percentage of trust value each year (recalculated as the trust grows or shrinks). CLAT pays a fixed dollar amount regardless of trust value. Locked for existing trusts — it was set at funding." />
        </div>
        <div role="radiogroup" aria-label="Payment type" className="flex gap-2">
          {(
            [
              ["unitrust", "CLUT", "CLUT (Unitrust — % of trust value)"],
              ["annuity", "CLAT", "CLAT (Annuity — fixed $ amount)"],
            ] as const
          ).map(([val, ariaName, label]) => {
            const active = value.payoutType === val;
            const disabled = !isNew;
            return (
              <button
                key={val}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={ariaName}
                disabled={disabled}
                onClick={() => {
                  if (disabled || active) return;
                  onChange({
                    ...value,
                    payoutType: val,
                    payoutPercent:
                      val === "unitrust" ? value.payoutPercent ?? 0.05 : undefined,
                    payoutAmount:
                      val === "annuity" ? value.payoutAmount ?? 0 : undefined,
                  });
                }}
                className={
                  "rounded-md border px-3 py-1 text-xs font-medium transition-colors " +
                  (active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-hair bg-card text-ink-3 hover:border-hair-2 hover:text-ink-2") +
                  (disabled ? " opacity-50 cursor-not-allowed" : "")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <label className={fieldLabelClassName} htmlFor="clt-inception-year">
              {isNew ? "Inception year" : "Original funding year"}
            </label>
            <FieldTooltip text="Year the trust is (or was) funded. Drives the §7520 lookup and the start year for the payment stream the engine projects forward." />
          </div>
          <input
            id="clt-inception-year"
            type="number"
            className={inputClassName}
            value={value.inceptionYear}
            onChange={(e) => set("inceptionYear", Number(e.target.value))}
          />
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <label className={fieldLabelClassName} htmlFor="clt-fmv">
              {isNew ? "Funding-year FMV" : "FMV at original funding"}
            </label>
            <FieldTooltip text="Fair market value of the assets contributed at inception. Anchors the income-interest calculation and sizes the taxable remainder gift the engine emits." />
          </div>
          {isNew ? (
            <SplitInterestFundingPicker
              id="clt-fmv"
              accounts={fundingAccounts ?? []}
              picks={fundingPicks ?? []}
              inceptionValue={value.inceptionValue}
              defaultGrantor={defaultGrantor ?? "client"}
              onChange={onFundingPicksChange ?? (() => {})}
            />
          ) : (
            <input
              id="clt-fmv"
              type="number"
              min={0}
              step={1}
              className={inputClassName}
              value={value.inceptionValue}
              onChange={(e) => set("inceptionValue", Number(e.target.value))}
            />
          )}
        </div>

        {value.payoutType === "unitrust" ? (
          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="clt-payout">
                Payout percentage
              </label>
              <FieldTooltip text="Annual distribution as a percent of trust FMV — recomputed each year as the trust grows or shrinks. Higher percentages produce a larger charitable deduction and a smaller taxable remainder gift." />
            </div>
            <div className="relative">
              <input
                id="clt-payout"
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
        ) : (
          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="clt-payout-amount">
                Annual payment
              </label>
              <FieldTooltip text="Fixed dollar amount paid to the charity each year regardless of trust value. Higher payments produce a larger charitable deduction and a smaller taxable remainder gift." />
            </div>
            <div className="relative">
              <input
                id="clt-payout-amount"
                type="number"
                step="1"
                min={0}
                className={`${inputClassName} pl-6`}
                value={value.payoutAmount ?? ""}
                onChange={(e) =>
                  set(
                    "payoutAmount",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
              />
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
                $
              </span>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5">
            <label className={fieldLabelClassName} htmlFor="clt-7520">
              IRC §7520 rate
            </label>
            <FieldTooltip text="IRS-published assumed earnings rate used to discount future trust payments. Locked at inception per Reg §1.7520-2 — drives the income-vs-remainder split that determines the charitable deduction and remainder gift." />
          </div>
          <div className="relative">
            <input
              id="clt-7520"
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
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="clt-term-type">
            Term type
          </label>
          <select
            id="clt-term-type"
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
            <label className={fieldLabelClassName} htmlFor="clt-term-years">
              Term years
            </label>
            <input
              id="clt-term-years"
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
            <label className={fieldLabelClassName} htmlFor="clt-life-1">
              Measuring life 1
            </label>
            <select
              id="clt-life-1"
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
            <label className={fieldLabelClassName} htmlFor="clt-life-2">
              Measuring life 2
            </label>
            <select
              id="clt-life-2"
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
          <label className={fieldLabelClassName} htmlFor="clt-charity">
            Charitable beneficiary
          </label>
          <select
            id="clt-charity"
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
            <span data-testid="clt-income-interest" className="text-right font-mono">
              {preview ? `$${preview.originalIncomeInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </span>
            <span className="text-ink-2">Remainder interest (taxable gift)</span>
            <span data-testid="clt-remainder-interest" className="text-right font-mono">
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
            Enter the values that were recorded when the CLT was funded — they
            were calculated from the §7520 rate and mortality table in effect at
            that time.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabelClassName} htmlFor="clt-original-income">
                Income interest (deduction taken)
              </label>
              <input
                id="clt-original-income"
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
              <label className={fieldLabelClassName} htmlFor="clt-original-remainder">
                Remainder interest (gift filed)
              </label>
              <input
                id="clt-original-remainder"
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
