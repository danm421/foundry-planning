"use client";

import { useMemo, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import { GLWB_PAYOUT_BANDS, payoutPercentForAge } from "@/engine/annuity";
// The four unions come from the engine, never a local copy.
// `EveryAnnuityContractField` below makes a new engine FIELD a compile error
// here; taking the unions from the engine makes a new engine VALUE one too — a
// local copy would let `PRODUCT_TYPE_LABELS` keep compiling while the dropdown
// sat a product behind the engine.
import type {
  AnnuityContract,
  AnnuityProductType,
  AnnuityTaxTreatment,
  AnnuityIncomeMode,
  AnnuityPayoutStructure,
} from "@/engine/annuity";
import { ageForYear } from "@/lib/age-year";
import { resolveMilestone } from "@/lib/milestones";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import { QLAC_PREMIUM_CAP_2026 } from "@/lib/schemas/annuities";
import { AnnuityPreviewChart, annuityPreviewAgeAtStart } from "./annuity-preview-chart";
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

/** Re-exported for this panel's consumers. The definitions are the engine's —
 *  see the import above. */
export type {
  AnnuityProductType,
  AnnuityTaxTreatment,
  AnnuityIncomeMode,
  AnnuityPayoutStructure,
};

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
  /** The account's own growth rate as a fraction. An annuity is not a
   *  growth-dropdown category, so `add-account-form` already holds this as a
   *  plain custom percent — no model-portfolio or category-default lookup is
   *  involved. Omitted, the preview states its own illustration rate. */
  growthRate?: number;
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
  qualified: "Qualified — IRA or plan money, not yet taxed",
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
    blurb: "A guaranteed payment for life that keeps coming after the balance runs out.",
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
  id, label, tooltip, value, onChange, placeholder,
}: {
  id: string;
  label: string;
  tooltip: string;
  value: number | null | undefined;
  onChange: (fraction: number | null) => void;
  placeholder?: string;
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

/** The two structures whose payout is defined by a stated number of years. */
function needsCertainTerm(structure: AnnuityPayoutStructure | null | undefined): boolean {
  return structure === "life_with_period_certain" || structure === "period_certain";
}

/** Mirrors the three DB CHECK constraints the PUT route enforces, so the form
 *  can hold the Save button instead of letting the advisor hit a 400 — plus two
 *  the database does NOT police. Postgres is happy to store a joint payout with
 *  no survivor share, or a period-certain payout with no term; `payout.ts` then
 *  reads `survivorPct ?? 0` (the survivor's income stops at the first death)
 *  and treats a null term as "no term at all" (the payments never end while the
 *  annuitant lives, and nothing carries to the beneficiary after). Those are
 *  wrong plans, not rejected ones, so nothing downstream would ever complain. */
export function annuityContractIncomplete(v: AnnuityContractValue): boolean {
  if (v.incomeMode === "none") return false;
  if (v.incomeMode === "rider" && v.benefitBase == null) return true;
  // `!(x > 0)`, not `== null` — a ZERO payment clears every null check in the
  // stack and then costs the client the whole account value for no income.
  if (v.incomeMode === "annuitized" && !((v.annuitizedPayment ?? 0) > 0)) return true;
  if (v.payoutStructure === "joint_survivor" && v.survivorPct == null) return true;
  if (needsCertainTerm(v.payoutStructure) && v.periodCertainYears == null) return true;
  return v.incomeStartYear == null && v.incomeStartYearRef == null;
}

/**
 * The income start year, resolved the way the PROJECTION resolves it —
 * `resolvedStart` in `src/lib/projection/load-client-data.ts:339`, which the
 * annuity loader is called with at `:723`. The milestone ref WINS and the
 * stored year is only its fallback, not the other way round. A contract
 * carrying both `2032` and "when Sam retires" pays from the milestone in the
 * plan, so the preview has to draw the milestone too or the picture and the
 * projection disagree about the year the income switches on.
 *
 * One deliberate divergence: where the projection substitutes the plan's start
 * year for a ref that will not resolve and no stored year, this returns null
 * and the chart says the start year is missing. Refusing to draw beats drawing
 * income that begins in a year nobody chose.
 */
function previewIncomeStartYear(
  v: AnnuityContractValue,
  milestones: ClientMilestones | undefined,
): number | null {
  const stored = v.incomeStartYear ?? null;
  if (!v.incomeStartYearRef) return stored;
  const resolved = milestones
    ? resolveMilestone(v.incomeStartYearRef, milestones, "start")
    : undefined;
  return resolved ?? stored;
}

/**
 * Every key of `AnnuityContract` made mandatory, values left as declared.
 *
 * The projection keeps its own copy of this mapping in
 * `src/lib/annuities/load-annuity-contracts.ts:46`, and the two cannot be
 * shared: that module imports `@/db` and Drizzle, which a client component must
 * not drag into the browser bundle, and it converts Drizzle's decimal STRINGS
 * where this converts the panel's nulls. What they do share is the field list —
 * so this alias makes adding a field to the engine contract a compile error
 * here, instead of leaving the preview silently one field behind the plan.
 */
type EveryAnnuityContractField = {
  [K in keyof Required<AnnuityContract>]: AnnuityContract[K];
};

/**
 * The panel spells "unset" as `null`; the engine's optional numbers are
 * `number | undefined`. Every engine read of these fields is a `??` or a
 * `!= null`, so the two spellings already behave identically — this only
 * reconciles the types, and resolves a milestone-based income start into the
 * calendar year the engine needs (it has no milestones of its own).
 *
 * Exported for its tests: the field-coverage pin and the start-year precedence.
 */
export function toEngineContract(
  v: AnnuityContractValue,
  milestones: ClientMilestones | undefined,
): EveryAnnuityContractField {
  const opt = (n: number | null | undefined) => n ?? undefined;
  return {
    carrier: v.carrier,
    contractNumberLast4: v.contractNumberLast4,
    productType: v.productType,
    taxTreatment: v.taxTreatment,
    costBasis: opt(v.costBasis),
    surrenderChargePct: opt(v.surrenderChargePct),
    surrenderEndYear: v.surrenderEndYear,
    annualFeePct: v.annualFeePct,
    incomeMode: v.incomeMode,
    incomeStartYear: previewIncomeStartYear(v, milestones),
    payoutStructure: v.payoutStructure,
    survivorPct: v.survivorPct,
    periodCertainYears: v.periodCertainYears,
    benefitBase: opt(v.benefitBase),
    rollupRate: opt(v.rollupRate),
    rollupEndYear: v.rollupEndYear,
    rollupRatchets: v.rollupRatchets,
    riderFeePct: opt(v.riderFeePct),
    payoutPct: opt(v.payoutPct),
    annuitizedPayment: opt(v.annuitizedPayment),
    expectedReturnYears: opt(v.expectedReturnYears),
  };
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
  growthRate,
}: AnnuityTabProps) {
  const thisYear = new Date().getFullYear();
  const set = <K extends keyof AnnuityContractValue>(
    key: K,
    next: AnnuityContractValue[K],
  ) => onChange({ ...value, [key]: next });

  // Built here rather than inline in the JSX below: passed inline it would be a
  // fresh object on every render of this panel, which busts the preview's own
  // memos and puts its Chart.js instance back to updating per keystroke.
  const previewContract = useMemo(
    () => toEngineContract(value, milestones),
    [value, milestones],
  );

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
      // The engine reads `payoutStructure` on every income mode — it is what
      // decides whether anything continues after the first death, rider or not.
      next.payoutStructure = value.payoutStructure ?? "single_life";
    }
    if (mode === "rider") {
      next.benefitBase = value.benefitBase ?? accountValue ?? null;
    }
    onChange(next);
  };

  const incomeStartYear = value.incomeStartYear ?? thisYear + 1;
  const ageAtIncomeStart = ageForYear(ownerBirthYear ?? null, incomeStartYear);
  const bandPlaceholder =
    ageAtIncomeStart != null ? fractionToDisplay(payoutPercentForAge(ageAtIncomeStart)) : undefined;
  const bandSummary = GLWB_PAYOUT_BANDS.map((b) => `${b.minAge}+: ${fractionToDisplay(b.percent)}%`)
    .reverse()
    .join(" · ");

  const qlacPremiumOverCap =
    value.productType === "qlac" && accountValue != null && accountValue > QLAC_PREMIUM_CAP_2026
      ? accountValue
      : null;

  return (
    <div className="space-y-4">
      {/* ── Contract ───────────────────────────────────────────────────────── */}
      <fieldset className="space-y-3 rounded-md border border-hair p-4">
        <legend className="px-2 text-sm font-semibold text-ink">Contract</legend>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <label className={fieldLabelClassName} htmlFor="annuity-carrier">Carrier</label>
              <FieldTooltip text="The insurance company that issued the contract — how the client recognizes the policy on a statement." />
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
            {qlacPremiumOverCap != null && (
              <p className={NOTE_CLASS}>
                A longevity annuity premium is capped at{" "}
                <span className="tabular">${QLAC_PREMIUM_CAP_2026.toLocaleString("en-US")}</span>{" "}
                for 2026. This account&apos;s value of{" "}
                <span className="tabular">${qlacPremiumOverCap.toLocaleString("en-US")}</span>{" "}
                is above the cap — worth confirming against the contract.
              </p>
            )}
          </div>

          {/* Read-only. The advisor sets this with the Account Type dropdown on
              the Details tab — `account_sub_type` carries the same three values,
              so the account row IS the treatment. A second editable copy here
              would let this panel and the account row disagree about the one
              fact §72 reads. */}
          <div>
            <div className="flex items-center gap-1.5">
              <span className={fieldLabelClassName}>How it&apos;s taxed</span>
              <FieldTooltip text="Money that was already taxed comes back partly tax-free. IRA and plan money is taxed in full; Roth money is not taxed at all." />
            </div>
            <p className="text-[14px] text-ink">{TAX_TREATMENT_LABELS[value.taxTreatment]}</p>
            <p className="mt-1 text-[11px] leading-snug text-ink-3">
              Set with <span className="text-ink-2">Account Type</span> on the Details tab.
            </p>
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

          {/* The tooltip says RECORDED, not applied. Nothing in `src/engine/`
              reads `surrenderChargePct` or `surrenderEndYear`, and the old copy
              ("Applied to withdrawals until the surrender period ends")
              promised the advisor in writing that a charge would be deducted. */}
          <PercentField
            id="annuity-surrender-pct"
            label="Surrender charge"
            tooltip="What the carrier keeps if the client cashes out early. Recorded for reference — the projection does not deduct it yet."
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
                  tooltip="First year the contract pays. Turning income on freezes the guarantee, so a later start buys a larger payment."
                  value={value.incomeStartYear}
                  onChange={(v) => onChange({ ...value, incomeStartYear: v, incomeStartYearRef: null })}
                />
              </div>
            )}

            {/* Who the payments follow. Shown for BOTH modes: the engine reads
                this on a rider too, and without it a joint rider stops paying
                at the first death. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <label className={fieldLabelClassName} htmlFor="annuity-structure">
                    Payout structure
                  </label>
                  <FieldTooltip text="Who the payments follow and for how long. This is what decides whether anything continues after the first death." />
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
                <div>
                  <PercentField
                    id="annuity-survivor"
                    label="Survivor share"
                    tooltip="Share of the payment that continues to the surviving spouse. 100% keeps the payment the same."
                    value={value.survivorPct}
                    onChange={(v) => set("survivorPct", v)}
                  />
                  {value.survivorPct == null && (
                    <p role="alert" className={REQUIRED_CLASS}>
                      Required — left blank, this pays the survivor nothing.
                    </p>
                  )}
                </div>
              )}

              {needsCertainTerm(value.payoutStructure) && (
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
                  {value.periodCertainYears == null && (
                    <p role="alert" className={REQUIRED_CLASS}>
                      Required — with no length the guarantee does nothing: nothing carries to
                      the beneficiary, and a period-certain payout runs on for life instead of
                      ending.
                    </p>
                  )}
                </div>
              )}
            </div>

            {value.incomeMode === "rider" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <MoneyField
                    id="annuity-benefit-base"
                    label="Benefit base"
                    tooltip="The figure the guaranteed payment is a percentage of. It is not withdrawable and it is not the account balance."
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
                  tooltip="Guaranteed yearly growth on the figure the payment is sized from, for as long as income is deferred."
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

      {/* The preview waits on the same predicate the Save button does: a
          half-described contract would draw a picture of a plan nobody has
          finished describing. */}
      {value.incomeMode !== "none" && !annuityContractIncomplete(value) && (
        <AnnuityPreviewChart
          contract={previewContract}
          accountValue={accountValue ?? null}
          startYear={thisYear}
          ownerAgeAtStart={annuityPreviewAgeAtStart(thisYear, ownerBirthYear)}
          growthRate={growthRate}
        />
      )}
    </div>
  );
}
