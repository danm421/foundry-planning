"use client";

import { useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import { GLWB_PAYOUT_BANDS, payoutPercentForAge } from "@/engine/annuity";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import { FieldTooltip } from "./field-tooltip";
import { fieldLabelClassName, inputClassName, selectClassName } from "./input-styles";

/**
 * "Income & Guarantees" — the advisor's only way to describe an annuity
 * contract. Mirrors `annuity_contracts` column-for-column and emits exactly the
 * body `src/lib/schemas/annuities.ts` accepts (which is `.strict()`, so no
 * extra keys and no `accountId`).
 *
 * Controlled and IO-free: `add-account-form` owns the contract state, loads it
 * from `GET /api/clients/[id]/annuity-contracts/[accountId]`, and PUTs it back
 * on save.
 */

/** IRS-indexed QLAC premium limit for 2026. Kept identical to the route's own
 *  copy in `annuity-contracts/[accountId]/route.ts` — both warn, neither
 *  blocks. */
export const QLAC_PREMIUM_CAP_2026 = 210_000;

export type AnnuityProductType =
  | "spia" | "dia" | "myga" | "fixed" | "fixed_indexed" | "variable" | "qlac";
export type AnnuityTaxTreatment = "qualified" | "non_qualified" | "tax_free";
export type AnnuityIncomeMode = "none" | "rider" | "annuitized";
export type AnnuityPayoutStructure =
  | "single_life" | "joint_survivor" | "life_with_period_certain"
  | "period_certain" | "cash_refund";

/** One annuity contract, shaped exactly like the PUT body. Rates are stored as
 *  fractions (0.06 = 6%); the panel displays whole numbers and converts. */
export interface AnnuityContractValue {
  carrier?: string | null;
  contractNumberLast4?: string | null;
  productType: AnnuityProductType;
  taxTreatment: AnnuityTaxTreatment;
  costBasis?: number | null;
  surrenderChargePct?: number | null;
  surrenderEndYear?: number | null;
  annualFeePct: number;
  incomeMode: AnnuityIncomeMode;
  incomeStartYear?: number | null;
  incomeStartYearRef?: YearRef | null;
  payoutStructure?: AnnuityPayoutStructure | null;
  survivorPct?: number | null;
  periodCertainYears?: number | null;
  benefitBase?: number | null;
  rollupRate?: number | null;
  rollupEndYear?: number | null;
  rollupRatchets: boolean;
  riderFeePct?: number | null;
  payoutPct?: number | null;
  annuitizedPayment?: number | null;
  expectedReturnYears?: number | null;
}

/** A brand-new contract, matching every DB column default. */
export const EMPTY_ANNUITY_CONTRACT: AnnuityContractValue = {
  productType: "fixed",
  taxTreatment: "non_qualified",
  annualFeePct: 0,
  incomeMode: "none",
  rollupRatchets: true,
};

export interface AnnuityTabProps {
  /** The contract's own key. Part of the panel's contract with its route; the
   *  panel itself does no IO, so nothing here reads it today — Task 10's
   *  preview and any future nested resource address the row by it. */
  accountId: string | null;
  clientId: string;
  value: AnnuityContractValue;
  onChange: (next: AnnuityContractValue) => void;
  /** The account's balance. A QLAC's premium is its value, and a fresh benefit
   *  base starts at the premium. */
  accountValue?: number;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  /** Annuitant's birth year — drives the age-band payout placeholder only. */
  ownerBirthYear?: number;
}

const PRODUCT_TYPE_LABELS: Record<AnnuityProductType, string> = {
  spia: "Immediate income",
  dia: "Deferred income",
  myga: "Multi-year guaranteed rate",
  fixed: "Fixed",
  fixed_indexed: "Fixed indexed",
  variable: "Variable",
  qlac: "Longevity annuity (QLAC)",
};

const TAX_TREATMENT_LABELS: Record<AnnuityTaxTreatment, string> = {
  qualified: "Qualified — IRA or plan money, never taxed yet",
  non_qualified: "Non-qualified — bought with money already taxed",
  tax_free: "Tax-free — Roth money",
};

const PAYOUT_STRUCTURE_LABELS: Record<AnnuityPayoutStructure, string> = {
  single_life: "Single life",
  joint_survivor: "Joint and survivor",
  life_with_period_certain: "Life with period certain",
  period_certain: "Period certain only",
  cash_refund: "Cash refund",
};

const INCOME_MODES: { mode: AnnuityIncomeMode; label: string; blurb: string }[] = [
  {
    mode: "none",
    label: "Not taking income yet",
    blurb: "The balance grows and nothing is paid out.",
  },
  {
    mode: "rider",
    label: "Income rider",
    blurb: "A guaranteed cheque for life that keeps coming after the balance runs out.",
  },
  {
    mode: "annuitized",
    label: "Annuitize",
    blurb: "The balance is handed to the carrier for a fixed payment stream.",
  },
];

/** 0.0625 → "6.25". Rounded because 0.06 * 100 is 6.000000000000001. */
function fractionToDisplay(fraction: number | null | undefined): string {
  if (fraction == null) return "";
  return String(Math.round(fraction * 1e6) / 1e4);
}

function displayToFraction(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null;
}

function displayToAmount(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Keeps whatever the advisor typed on screen until they leave the field.
 * Without it a controlled numeric field is un-typeable past the decimal point:
 * "6." parses to 6, re-renders as "6", and eats the dot before "6.25" can be
 * finished.
 */
function useTypingBuffer(committed: string) {
  const [buffer, setBuffer] = useState<string | null>(null);
  return {
    display: buffer ?? committed,
    onType: setBuffer,
    onSettle: () => setBuffer(null),
  };
}

function PercentField({
  id, label, tooltip, value, onChange, placeholder, disabled,
}: {
  id: string;
  label: string;
  tooltip: string;
  value: number | null | undefined;
  onChange: (fraction: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const buffer = useTypingBuffer(fractionToDisplay(value));
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className={fieldLabelClassName} htmlFor={id}>{label}</label>
        <FieldTooltip text={tooltip} />
      </div>
      <PercentInput
        id={id}
        value={buffer.display}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(raw) => { buffer.onType(raw); onChange(displayToFraction(raw)); }}
        onBlur={buffer.onSettle}
      />
    </div>
  );
}

function MoneyField({
  id, label, tooltip, value, onChange, placeholder,
}: {
  id: string;
  label: string;
  tooltip: string;
  value: number | null | undefined;
  onChange: (amount: number | null) => void;
  placeholder?: string;
}) {
  const buffer = useTypingBuffer(value == null ? "" : String(value));
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className={fieldLabelClassName} htmlFor={id}>{label}</label>
        <FieldTooltip text={tooltip} />
      </div>
      <CurrencyInput
        id={id}
        value={buffer.display}
        placeholder={placeholder}
        onChange={(raw) => { buffer.onType(raw); onChange(displayToAmount(raw)); }}
        onBlur={buffer.onSettle}
      />
    </div>
  );
}

function YearField({
  id, label, tooltip, value, onChange,
}: {
  id: string;
  label: string;
  tooltip: string;
  value: number | null | undefined;
  onChange: (year: number | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className={fieldLabelClassName} htmlFor={id}>{label}</label>
        <FieldTooltip text={tooltip} />
      </div>
      <input
        id={id}
        type="number"
        min={2000}
        max={2100}
        className={inputClassName}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </div>
  );
}

/** Mirrors the three DB CHECK constraints the PUT route enforces, so the form
 *  can hold the Save button instead of letting the advisor hit a 400. */
export function annuityContractIncomplete(v: AnnuityContractValue): boolean {
  if (v.incomeMode === "none") return false;
  if (v.incomeMode === "rider" && v.benefitBase == null) return true;
  if (v.incomeMode === "annuitized" && v.annuitizedPayment == null) return true;
  return v.incomeStartYear == null && v.incomeStartYearRef == null;
}

const REQUIRED_CLASS = "mt-1 text-[11px] text-crit";
const NOTE_CLASS = "mt-1 text-[11px] leading-snug text-warn";

export function AnnuityTab({
  value,
  onChange,
  accountValue,
  milestones,
  clientFirstName,
  spouseFirstName,
  ownerBirthYear,
}: AnnuityTabProps) {
  const thisYear = new Date().getFullYear();
  const set = <K extends keyof AnnuityContractValue>(
    key: K,
    next: AnnuityContractValue[K],
  ) => onChange({ ...value, [key]: next });

  /**
   * Switching the mode seeds the fields that mode makes mandatory, so the
   * contract is never left in a shape the DB's CHECK constraints reject. A
   * benefit base opens at the premium, which is how carriers issue them.
   */
  const setMode = (mode: AnnuityIncomeMode) => {
    if (mode === value.incomeMode) return;
    const next: AnnuityContractValue = { ...value, incomeMode: mode };
    if (mode !== "none") {
      next.incomeStartYear = value.incomeStartYear ?? (value.incomeStartYearRef ? null : thisYear + 1);
    }
    if (mode === "rider") {
      next.benefitBase = value.benefitBase ?? accountValue ?? null;
    }
    if (mode === "annuitized") {
      next.payoutStructure = value.payoutStructure ?? "single_life";
    }
    onChange(next);
  };

  const incomeStartYear = value.incomeStartYear ?? thisYear + 1;
  const ageAtIncomeStart = ownerBirthYear != null ? incomeStartYear - ownerBirthYear : null;
  const bandPlaceholder =
    ageAtIncomeStart != null ? fractionToDisplay(payoutPercentForAge(ageAtIncomeStart)) : undefined;
  const bandSummary = GLWB_PAYOUT_BANDS.map((b) => `${b.minAge}+: ${fractionToDisplay(b.percent)}%`)
    .reverse()
    .join(" · ");

  const qlacOverCap =
    value.productType === "qlac" && accountValue != null && accountValue > QLAC_PREMIUM_CAP_2026;

  return (
    <div className="space-y-4">
      {/* ── Contract ───────────────────────────────────────────────────────── */}
      <fieldset className="space-y-3 rounded-md border border-hair p-4">
        <legend className="px-2 text-sm font-semibold text-ink">Contract</legend>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="annuity-carrier">Carrier</label>
              <FieldTooltip text="The insurance company that issued the contract. Shown on reports so the client recognises the policy." />
            </div>
            <input
              id="annuity-carrier"
              type="text"
              className={inputClassName}
              value={value.carrier ?? ""}
              placeholder="e.g. Athene"
              onChange={(e) => set("carrier", e.target.value === "" ? null : e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="annuity-last4">Contract number (last 4)</label>
              <FieldTooltip text="Last four digits only, so the policy can be matched to a statement without storing the full number." />
            </div>
            <input
              id="annuity-last4"
              type="text"
              inputMode="numeric"
              maxLength={4}
              className={inputClassName}
              value={value.contractNumberLast4 ?? ""}
              onChange={(e) =>
                set("contractNumberLast4", e.target.value === "" ? null : e.target.value)
              }
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="annuity-product">Product type</label>
              <FieldTooltip text="Sets what the contract is expected to do. A longevity annuity is the only one the IRS caps by premium." />
            </div>
            <select
              id="annuity-product"
              className={selectClassName}
              value={value.productType}
              onChange={(e) => set("productType", e.target.value as AnnuityProductType)}
            >
              {(Object.keys(PRODUCT_TYPE_LABELS) as AnnuityProductType[]).map((p) => (
                <option key={p} value={p}>{PRODUCT_TYPE_LABELS[p]}</option>
              ))}
            </select>
            {qlacOverCap && (
              <p className={NOTE_CLASS}>
                A longevity annuity premium is capped at{" "}
                <span className="tabular">${QLAC_PREMIUM_CAP_2026.toLocaleString("en-US")}</span>{" "}
                for 2026. This account&apos;s value of{" "}
                <span className="tabular">${accountValue!.toLocaleString("en-US")}</span>{" "}
                is above the cap — worth confirming against the contract.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="annuity-tax">How it&apos;s taxed</label>
              <FieldTooltip text="Money that was already taxed comes back partly tax-free. IRA and plan money is taxed in full; Roth money is not taxed at all." />
            </div>
            <select
              id="annuity-tax"
              className={selectClassName}
              value={value.taxTreatment}
              onChange={(e) => set("taxTreatment", e.target.value as AnnuityTaxTreatment)}
            >
              {(Object.keys(TAX_TREATMENT_LABELS) as AnnuityTaxTreatment[]).map((t) => (
                <option key={t} value={t}>{TAX_TREATMENT_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <MoneyField
              id="annuity-cost-basis"
              label="Cost basis"
              tooltip="The money the client put in that has already been taxed. Withdrawals come out of growth first, so the wrong figure taxes the wrong dollars."
              value={value.costBasis}
              onChange={(v) => set("costBasis", v)}
              placeholder="Ask the carrier"
            />
            {value.costBasis == null && (
              <p className={NOTE_CLASS}>
                Not on file — until it&apos;s set, the plan treats the whole balance as money the
                client has already paid tax on, so withdrawals will look tax-free when they may not
                be.
              </p>
            )}
          </div>

          <PercentField
            id="annuity-fee"
            label="Annual contract fee"
            tooltip="Mortality, expense, and administration charges the carrier takes off the balance every year."
            value={value.annualFeePct}
            onChange={(v) => set("annualFeePct", v ?? 0)}
          />

          <PercentField
            id="annuity-surrender-pct"
            label="Surrender charge"
            tooltip="What the carrier keeps if the client cashes out early. Applied to withdrawals until the surrender period ends."
            value={value.surrenderChargePct}
            onChange={(v) => set("surrenderChargePct", v)}
          />

          <YearField
            id="annuity-surrender-end"
            label="Surrender charge ends"
            tooltip="Last year the surrender charge applies. After this the balance is free to move."
            value={value.surrenderEndYear}
            onChange={(v) => set("surrenderEndYear", v)}
          />
        </div>
      </fieldset>

      {/* ── Income ─────────────────────────────────────────────────────────── */}
      <fieldset className="space-y-3 rounded-md border border-hair p-4">
        <legend className="px-2 text-sm font-semibold text-ink">Income</legend>

        <div role="radiogroup" aria-label="Income mode" className="grid gap-2 sm:grid-cols-3">
          {INCOME_MODES.map(({ mode, label, blurb }) => {
            const active = value.incomeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(mode)}
                className={
                  "rounded-md border px-3 py-2 text-left transition-colors " +
                  (active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-hair bg-card text-ink-3 hover:border-hair-2 hover:text-ink-2")
                }
              >
                <span className="block text-xs font-medium">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{blurb}</span>
              </button>
            );
          })}
        </div>

        {value.incomeMode !== "none" && (
          <div className="space-y-3 border-t border-hair pt-3">
            {milestones ? (
              <div className="max-w-xs">
                <MilestoneYearPicker
                  id="annuity-income-start"
                  name="annuityIncomeStartYear"
                  label="Income starts"
                  value={incomeStartYear}
                  yearRef={value.incomeStartYearRef ?? null}
                  milestones={milestones}
                  clientFirstName={clientFirstName}
                  spouseFirstName={spouseFirstName}
                  position="start"
                  onChange={(year, ref) =>
                    onChange({ ...value, incomeStartYear: year, incomeStartYearRef: ref })
                  }
                />
              </div>
            ) : (
              <div className="max-w-xs">
                <YearField
                  id="annuity-income-start"
                  label="Income starts"
                  tooltip="First year the contract pays. Turning income on freezes the guarantee, so a later start buys a larger cheque."
                  value={value.incomeStartYear}
                  onChange={(v) => onChange({ ...value, incomeStartYear: v, incomeStartYearRef: null })}
                />
              </div>
            )}

            {value.incomeMode === "rider" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <MoneyField
                    id="annuity-benefit-base"
                    label="Benefit base"
                    tooltip="The figure the guaranteed cheque is a percentage of. It is not withdrawable and it is not the account balance."
                    value={value.benefitBase}
                    onChange={(v) => set("benefitBase", v)}
                  />
                  {value.benefitBase == null && (
                    <p role="alert" className={REQUIRED_CLASS}>
                      Required — the guarantee is sized off this figure.
                    </p>
                  )}
                </div>

                <PercentField
                  id="annuity-rollup-rate"
                  label="Roll-up rate"
                  tooltip="Guaranteed yearly growth on the figure the cheque is sized from, for as long as income is deferred."
                  value={value.rollupRate}
                  onChange={(v) => set("rollupRate", v)}
                />

                <YearField
                  id="annuity-rollup-end"
                  label="Roll-up runs through"
                  tooltip="Last year the guaranteed growth is credited. Leave blank to keep crediting until income starts."
                  value={value.rollupEndYear}
                  onChange={(v) => set("rollupEndYear", v)}
                />

                <PercentField
                  id="annuity-rider-fee"
                  label="Rider fee"
                  tooltip="What the guarantee costs each year. Usually charged against the benefit base, not the balance."
                  value={value.riderFeePct}
                  onChange={(v) => set("riderFeePct", v)}
                />

                <PercentField
                  id="annuity-payout-pct"
                  label="Payout rate"
                  tooltip={`Share of the benefit base paid each year once income starts. Left blank, the age band at the start year is used — ${bandSummary}.`}
                  value={value.payoutPct}
                  onChange={(v) => set("payoutPct", v)}
                  placeholder={bandPlaceholder}
                />

                {/* The tooltip sits OUTSIDE the label: text nested inside a
                    <label> becomes part of that control's accessible name. */}
                <div className="col-span-2 flex items-center gap-1.5">
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={value.rollupRatchets}
                      onChange={(e) => set("rollupRatchets", e.target.checked)}
                    />
                    <span>Steps up with the market</span>
                  </label>
                  <FieldTooltip text="When the account beats the guarantee, the benefit base locks in at the higher balance. Off means only the guaranteed rate ever applies." />
                </div>
              </div>
            )}

            {value.incomeMode === "annuitized" && (
              <div className="grid grid-cols-2 gap-3">
                <p className={`col-span-2 ${NOTE_CLASS}`}>
                  Annuitizing is irreversible. The client trades the balance for a guaranteed
                  payment stream — the account drops to zero in the start year, and there is
                  nothing left to withdraw or leave to heirs.
                </p>

                <div>
                  <MoneyField
                    id="annuity-payment"
                    label="Annual payment"
                    tooltip="Total the carrier pays each year. Take it from the contract or the carrier's illustration."
                    value={value.annuitizedPayment}
                    onChange={(v) => set("annuitizedPayment", v)}
                  />
                  {value.annuitizedPayment == null && (
                    <p role="alert" className={REQUIRED_CLASS}>
                      Required — this is the whole income stream.
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-1.5">
                    <label className={fieldLabelClassName} htmlFor="annuity-structure">
                      Payout structure
                    </label>
                    <FieldTooltip text="Who the payments follow and for how long. This decides whether anything continues after the first death." />
                  </div>
                  <select
                    id="annuity-structure"
                    className={selectClassName}
                    value={value.payoutStructure ?? "single_life"}
                    onChange={(e) => set("payoutStructure", e.target.value as AnnuityPayoutStructure)}
                  >
                    {(Object.keys(PAYOUT_STRUCTURE_LABELS) as AnnuityPayoutStructure[]).map((s) => (
                      <option key={s} value={s}>{PAYOUT_STRUCTURE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>

                {value.payoutStructure === "joint_survivor" && (
                  <PercentField
                    id="annuity-survivor"
                    label="Survivor share"
                    tooltip="Share of the payment that continues to the surviving spouse. 100% keeps the cheque the same."
                    value={value.survivorPct}
                    onChange={(v) => set("survivorPct", v)}
                  />
                )}

                {(value.payoutStructure === "life_with_period_certain" ||
                  value.payoutStructure === "period_certain") && (
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label className={fieldLabelClassName} htmlFor="annuity-period-certain">
                        Guaranteed years
                      </label>
                      <FieldTooltip text="Years the payment is guaranteed even if the annuitant dies first — it goes to the beneficiary instead." />
                    </div>
                    <input
                      id="annuity-period-certain"
                      type="number"
                      min={0}
                      max={50}
                      className={inputClassName}
                      value={value.periodCertainYears ?? ""}
                      onChange={(e) =>
                        set(
                          "periodCertainYears",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-1.5">
                    <label className={fieldLabelClassName} htmlFor="annuity-expected-years">
                      Expected payout years
                    </label>
                    <FieldTooltip text="How many years of payments the tax-free portion is spread over. Leave blank to use the IRS life-expectancy table." />
                  </div>
                  <input
                    id="annuity-expected-years"
                    type="number"
                    min={1}
                    max={70}
                    className={inputClassName}
                    value={value.expectedReturnYears ?? ""}
                    placeholder="IRS table"
                    onChange={(e) =>
                      set(
                        "expectedReturnYears",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {/* Task 10 mounts <AnnuityPreviewChart> here — the account-value /
          guaranteed-income crossover. */}
    </div>
  );
}
