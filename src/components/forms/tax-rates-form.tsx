"use client";

import { useState } from "react";
import { PercentInput } from "@/components/percent-input";
import { CurrencyInput } from "@/components/currency-input";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { AutosaveStatus } from "@/components/autosave-status";
import { usePlanSettingsAutosave } from "@/components/forms/use-plan-settings-autosave";
import { selectClassName } from "@/components/forms/input-styles";
import { STATE_ESTATE_TAX, INHERITANCE_TAX_STATES, type Bracket } from "@/lib/tax/state-estate";
import {
  CAPITAL_LOSS_ORDINARY_LIMIT,
  CAPITAL_LOSS_ORDINARY_LIMIT_MFS,
} from "@/lib/tax/constants";
import type { FilingStatus } from "@/lib/tax/types";
import { USPS_STATE_NAMES, USPS_STATE_CODES, type USPSStateCode } from "@/lib/usps-states";
import { useClientAccess } from "@/components/client-access-provider";

interface TaxRatesFormProps {
  clientId: string;
  flatFederalRate: string;
  flatStateRate: string;
  estateAdminExpenses: string;
  flatStateEstateRate: string;
  residenceState: USPSStateCode | null;
  irdTaxRate: string;
  probateCostRate: string;
  pvDiscountRate: string;
  lifetimeExemptionCap: string;
  outOfHouseholdDniRate: string;
  priorTaxableGiftsClient: string;
  priorTaxableGiftsSpouse: string;
  coveredByWorkplacePlan: "auto" | "yes" | "no";
  spouseCoveredByWorkplacePlan: "auto" | "yes" | "no";
  capitalLossCarryforwardSt: string;
  capitalLossCarryforwardLt: string;
  /** Set when the LT default above was auto-filled from an analyzed tax
   *  return (rather than a previously-saved value) — renders a "from 20XX
   *  return — needs review" hint, since `getLatestTaxReturn` returns the
   *  newest row regardless of QA status and a freshly-extracted return is
   *  `needs_review` until an advisor confirms it. Null once the advisor has
   *  an actual stored value. */
  capitalLossCarryforwardLtSourceYear?: number | null;
  /** Drives the §1211(b) limit quoted in the carryforward field help —
   *  $1,500 for married-filing-separately, $3,000 otherwise. Optional: falls
   *  back to the non-MFS limit, mirroring `capitalLossRows` in
   *  `lib/tax/cell-drill/income-breakdown.ts`. */
  filingStatus?: FilingStatus;
  hasSpouse: boolean;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialMode?: "flat" | "bracket";
}

const pct = (v: string) => (Number(v) * 100).toFixed(2);
// Like `pct`, but leaves a blank/null-backed value blank instead of showing "0.00" —
// used for fields whose blank state carries meaning (falls back to another rate)
// rather than defaulting to zero.
const pctOrBlank = (v: string) => (v === "" ? "" : (Number(v) * 100).toFixed(2));

/** A typed percent → the decimal fraction the API stores. `undefined` while the
 *  box holds something that isn't a number yet ("-", "."), so a half-typed
 *  value is withheld instead of writing a NaN. Blank means zero, matching what
 *  the Save button used to submit. */
function toDecimal(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return "0";
  const n = Number(trimmed);
  return Number.isFinite(n) ? String(n / 100) : undefined;
}

/** Same, for percent fields whose blank state means "fall back to another
 *  rate" rather than zero. */
function toDecimalOrNull(raw: string): string | null | undefined {
  return raw.trim() === "" ? null : toDecimal(raw);
}

/** A typed dollar amount → the plain number string the API stores. */
function toAmount(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return "0";
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
}

/** Same, for amounts whose blank state means "unset" rather than zero. */
function toAmountOrNull(raw: string): string | null | undefined {
  return raw.trim() === "" ? null : toAmount(raw);
}

function topRate(brackets: Bracket[]): number {
  return brackets.reduce((m, b) => Math.max(m, b.rate), 0);
}

type EstateRule = { exemption: number; brackets: Bracket[] } | undefined;

function estateRuleFor(code: USPSStateCode): EstateRule {
  return (STATE_ESTATE_TAX as Record<string, EstateRule>)[code];
}

/** What the selected state actually means for the plan, as a value line under
 *  the picker — the numbers the advisor would otherwise have to look up. */
function residenceSummary(code: USPSStateCode | ""): React.ReactNode {
  if (code === "") return "No state set — the flat income and estate rates below apply.";
  const rule = estateRuleFor(code);
  const inheritance = INHERITANCE_TAX_STATES.has(code);
  if (!rule) return inheritance ? "Inheritance tax only." : "No state estate or inheritance tax.";
  return (
    <>
      <span className="tabular">${(rule.exemption / 1_000_000).toFixed(2)}M</span> exemption · top{" "}
      <span className="tabular">{Math.round(topRate(rule.brackets) * 100)}%</span>
      {inheritance && " · inheritance tax"}
    </>
  );
}

/** The editable settings this form owns. Every name is also the API key the
 *  patch is sent under. */
type FieldKey =
  | "flatFederalRate"
  | "flatStateRate"
  | "estateAdminExpenses"
  | "flatStateEstateRate"
  | "irdTaxRate"
  | "probateCostRate"
  | "pvDiscountRate"
  | "lifetimeExemptionCap"
  | "outOfHouseholdDniRate"
  | "priorTaxableGiftsClient"
  | "priorTaxableGiftsSpouse"
  | "capitalLossCarryforwardSt"
  | "capitalLossCarryforwardLt"
  | "coveredByWorkplacePlan"
  | "spouseCoveredByWorkplacePlan";

// Shared by the client + spouse workplace-plan-coverage selects below.
const DEPENDENT_OVERRIDE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

function Card({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-hair bg-card">
      <header className="flex items-center gap-1.5 border-b border-hair px-4 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h3>
        {help && <FieldTooltip text={help} />}
      </header>
      <div className="divide-y divide-hair">{children}</div>
    </section>
  );
}

function Row({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <label
        htmlFor={htmlFor}
        className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-snug text-ink-2"
      >
        <span>{label}</span>
        {help && <FieldTooltip text={help} />}
      </label>
      <div className="w-40 shrink-0">{children}</div>
    </div>
  );
}

export default function TaxRatesForm({
  clientId,
  flatFederalRate,
  flatStateRate,
  estateAdminExpenses,
  flatStateEstateRate,
  residenceState,
  irdTaxRate,
  probateCostRate,
  pvDiscountRate,
  lifetimeExemptionCap,
  outOfHouseholdDniRate,
  priorTaxableGiftsClient,
  priorTaxableGiftsSpouse,
  coveredByWorkplacePlan,
  spouseCoveredByWorkplacePlan,
  capitalLossCarryforwardSt,
  capitalLossCarryforwardLt,
  capitalLossCarryforwardLtSourceYear,
  filingStatus,
  hasSpouse,
  clientFirstName,
  spouseFirstName,
  initialMode = "flat",
}: TaxRatesFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const { save, state, error, retry } = usePlanSettingsAutosave(clientId);

  const [mode, setMode] = useState<"flat" | "bracket">(initialMode);
  // One control now, not two: residence drives both the income-tax and the
  // estate engine, and mirroring it across two selects was the page's most
  // reliable source of "which one is the real one?".
  const [residence, setResidence] = useState<USPSStateCode | "">(residenceState ?? "");

  // Every field is controlled so a `router.refresh()` triggered by a save can't
  // rewrite a box the advisor is still typing in. Keys match the API's, so a
  // patch is `{ [key]: converted }` with no lookup table in between.
  const [values, setValues] = useState<Record<FieldKey, string>>({
    flatFederalRate: pct(flatFederalRate),
    flatStateRate: pct(flatStateRate),
    estateAdminExpenses,
    flatStateEstateRate: pct(flatStateEstateRate),
    irdTaxRate: pct(irdTaxRate),
    probateCostRate: pct(probateCostRate),
    pvDiscountRate: pctOrBlank(pvDiscountRate),
    lifetimeExemptionCap,
    outOfHouseholdDniRate: pct(outOfHouseholdDniRate),
    priorTaxableGiftsClient,
    priorTaxableGiftsSpouse,
    capitalLossCarryforwardSt,
    capitalLossCarryforwardLt,
    coveredByWorkplacePlan,
    spouseCoveredByWorkplacePlan,
  });

  /** Show the raw keystrokes immediately; queue the converted value only when
   *  it is one the API should store. */
  function update(key: FieldKey, raw: string, apiValue: unknown) {
    setValues((v) => ({ ...v, [key]: raw }));
    if (apiValue !== undefined) save({ [key]: apiValue });
  }

  // §1211(b) annual ordinary-income offset. Both carryforward fields quoted a
  // hardcoded "$3,000" — the same MFS error already fixed in the drill-down
  // tooltip.
  const capitalLossLimit =
    filingStatus === "married_separate"
      ? CAPITAL_LOSS_ORDINARY_LIMIT_MFS
      : CAPITAL_LOSS_ORDINARY_LIMIT;
  const capitalLossHelp =
    "From Schedule D of the client's most recent return. Offsets future gains, " +
    `plus up to $${capitalLossLimit.toLocaleString("en-US")} of ordinary income per year.`;

  const workplacePlanHelp =
    "Overrides the projection's inference (active 401(k)/403(b)/SIMPLE participation or employer match that year) for the IRA deduction phaseout and Saver's Credit eligibility. Auto defers to that inference.";

  return (
    <div className="@container space-y-4">
      <div className="flex items-center justify-end">
        {canEdit && <AutosaveStatus state={state} error={error} onRetry={retry} />}
      </div>

      <fieldset disabled={!canEdit} className="m-0 space-y-4 border-0 p-0">
        {/* Residence and calculation method sit above the split because each
            one changes what the cards below mean. */}
        <section className="rounded-[var(--radius)] border border-hair bg-card p-4">
          <div className="grid gap-4 @xl:grid-cols-2">
            <div>
              <label
                htmlFor="residenceState"
                className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink-2"
              >
                <span>State of residence</span>
                <FieldTooltip text="Drives both engines. In bracket mode the income-tax engine uses this state's brackets, deductions and exemptions; the estate engine uses its estate and inheritance tax rules. Leave it unset to fall back to the flat rates." />
              </label>
              <select
                id="residenceState"
                aria-describedby="residenceState-summary"
                value={residence}
                onChange={(e) => {
                  const next = e.target.value === "" ? "" : (e.target.value as USPSStateCode);
                  setResidence(next);
                  save({ residenceState: next === "" ? null : next });
                }}
                className={selectClassName}
              >
                <option value="">— Not set —</option>
                {USPS_STATE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {USPS_STATE_NAMES[code]}
                  </option>
                ))}
              </select>
              <p id="residenceState-summary" className="mt-1.5 text-[12px] text-ink-3">
                {residenceSummary(residence)}
              </p>
            </div>

            <div>
              <span
                id="tax-calc-method-label"
                className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink-2"
              >
                <span>Income tax calculation</span>
                <FieldTooltip text="Bracket mode uses progressive federal brackets, AMT, NIIT, and FICA based on filing status. Flat mode multiplies taxable income by your federal rate." />
              </span>
              <div
                role="group"
                aria-labelledby="tax-calc-method-label"
                className="inline-flex rounded-[var(--radius-sm)] border border-hair-2 bg-paper p-0.5"
              >
                {(["flat", "bracket"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => {
                      setMode(m);
                      save({ taxEngineMode: m });
                    }}
                    className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] transition-colors ${
                      // A selected mode is state, not an action — accent-wash
                      // marks it without spending the CTA fill on a toggle.
                      mode === m
                        ? "bg-accent-wash font-medium text-ink"
                        : "text-ink-3 hover:text-ink"
                    }`}
                  >
                    {m === "flat" ? "Flat rate" : "Bracket-based"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="grid items-start gap-4 @2xl:grid-cols-2">
          {/* Left column — everything the income-tax engine reads. */}
          <div className="space-y-4">
            <Card
              title="Income tax"
              help="Rates applied to taxable income across the projection. In bracket mode the federal rate is unused and the state rate applies only when no state of residence is set."
            >
              {mode === "flat" && (
                <Row
                  label="Federal rate"
                  htmlFor="flatFederalRate"
                  help="The single rate applied to every dollar of taxable income while the plan runs in flat mode. Bracket mode ignores it."
                >
                  <PercentInput
                    id="flatFederalRate"
                    value={values.flatFederalRate}
                    onChange={(raw) => update("flatFederalRate", raw, toDecimal(raw))}
                  />
                </Row>
              )}
              <Row
                label="State rate"
                htmlFor="flatStateRate"
                help="Applied to taxable income whenever no state of residence is set above, and in flat mode regardless of state."
              >
                <PercentInput
                  id="flatStateRate"
                  value={values.flatStateRate}
                  onChange={(raw) => update("flatStateRate", raw, toDecimal(raw))}
                />
              </Row>
              <Row
                label={hasSpouse ? `Workplace plan — ${clientFirstName ?? "Client"}` : "Covered by workplace plan"}
                htmlFor="coveredByWorkplacePlan"
                help={workplacePlanHelp}
              >
                <select
                  id="coveredByWorkplacePlan"
                  value={values.coveredByWorkplacePlan}
                  onChange={(e) =>
                    update(
                      "coveredByWorkplacePlan",
                      e.target.value,
                      e.target.value,
                    )
                  }
                  className={selectClassName}
                >
                  {DEPENDENT_OVERRIDE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              {hasSpouse && (
                <Row
                  label={`Workplace plan — ${spouseFirstName ?? "Spouse"}`}
                  htmlFor="spouseCoveredByWorkplacePlan"
                  help="Same override, applied to the spouse's workplace-plan coverage."
                >
                  <select
                    id="spouseCoveredByWorkplacePlan"
                    value={values.spouseCoveredByWorkplacePlan}
                    onChange={(e) =>
                      update(
                        "spouseCoveredByWorkplacePlan",
                        e.target.value,
                        e.target.value,
                      )
                    }
                    className={selectClassName}
                  >
                    {DEPENDENT_OVERRIDE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
            </Card>

            <Card title="Capital loss carryforward">
              <Row label="Short-term" htmlFor="capitalLossCarryforwardSt" help={capitalLossHelp}>
                <CurrencyInput
                  id="capitalLossCarryforwardSt"
                  value={values.capitalLossCarryforwardSt}
                  onChange={(raw) =>
                    update("capitalLossCarryforwardSt", raw, toAmountOrNull(raw))
                  }
                />
              </Row>
              <Row label="Long-term" htmlFor="capitalLossCarryforwardLt" help={capitalLossHelp}>
                <CurrencyInput
                  id="capitalLossCarryforwardLt"
                  value={values.capitalLossCarryforwardLt}
                  onChange={(raw) =>
                    update("capitalLossCarryforwardLt", raw, toAmountOrNull(raw))
                  }
                />
                {capitalLossCarryforwardLtSourceYear != null && (
                  <p className="mt-1 text-[12px] text-ink-4">
                    from <span className="tabular">{capitalLossCarryforwardLtSourceYear}</span>{" "}
                    return — needs review
                  </p>
                )}
              </Row>
            </Card>

            <Card
              title="Trust tax"
              help="Applied when a non-grantor trust distributes income to a beneficiary outside the household."
            >
              <Row
                label="Out-of-household DNI rate"
                htmlFor="outOfHouseholdDniRate"
                help="Records an estimated recipient-side tax in the plan's tax summary. Defaults to top federal bracket (37%)."
              >
                <PercentInput
                  id="outOfHouseholdDniRate"
                  value={values.outOfHouseholdDniRate}
                  onChange={(raw) => update("outOfHouseholdDniRate", raw, toDecimal(raw))}
                />
              </Row>
            </Card>
          </div>

          {/* Right column — everything settled at a death event. */}
          <div className="space-y-4">
            <Card title="Estate tax" help="Applied at each death event in the projection.">
              <Row
                label="Administrative expenses"
                htmlFor="estateAdminExpenses"
                help="Estimated cost of settling the estate — executor and attorney fees, appraisals, court filings. Deducted from the gross estate before federal estate tax."
              >
                <CurrencyInput
                  id="estateAdminExpenses"
                  value={values.estateAdminExpenses}
                  onChange={(raw) => update("estateAdminExpenses", raw, toAmount(raw))}
                />
              </Row>
              <Row
                label="State estate override rate"
                htmlFor="flatStateEstateRate"
                help="Used only when no state of residence is set above. Set it to 0 to skip state estate tax entirely."
              >
                <PercentInput
                  id="flatStateEstateRate"
                  value={values.flatStateEstateRate}
                  onChange={(raw) => update("flatStateEstateRate", raw, toDecimal(raw))}
                />
              </Row>
              <Row
                label="IRD tax rate"
                htmlFor="irdTaxRate"
                help="Applied to pre-tax retirement assets (Traditional IRA, 401(k), 403(b)) passing to a non-spouse, non-charity beneficiary at death."
              >
                <PercentInput
                  id="irdTaxRate"
                  value={values.irdTaxRate}
                  onChange={(raw) => update("irdTaxRate", raw, toDecimal(raw))}
                />
              </Row>
              <Row
                label="Probate cost rate"
                htmlFor="probateCostRate"
                help="Applied to the probate estate — assets passing through the will. Excludes jointly-titled property, beneficiary-designated accounts (life insurance, IRA/401(k), POD/TOD), and assets held in a trust."
              >
                <PercentInput
                  id="probateCostRate"
                  value={values.probateCostRate}
                  onChange={(raw) => update("probateCostRate", raw, toDecimal(raw))}
                />
              </Row>
              <Row
                label="PV discount rate"
                htmlFor="pvDiscountRate"
                help="Discounts future estate values back into today's dollars. Defaults to the plan's inflation rate when left blank."
              >
                <PercentInput
                  id="pvDiscountRate"
                  value={values.pvDiscountRate}
                  placeholder="Inflation"
                  onChange={(raw) => update("pvDiscountRate", raw, toDecimalOrNull(raw))}
                />
              </Row>
              <Row
                label="Lifetime exemption cap"
                htmlFor="lifetimeExemptionCap"
                help="Caps how high the federal estate/gift exemption grows. Leave blank to grow with inflation indefinitely. Enter a dollar amount to grow toward that ceiling and then freeze — or, if below today's exemption (~$15M), to freeze the exemption at that value for the whole plan."
              >
                <CurrencyInput
                  id="lifetimeExemptionCap"
                  value={values.lifetimeExemptionCap}
                  placeholder="No cap"
                  onChange={(raw) => {
                    // A cap of zero is meaningless — it reads as "no cap", the
                    // same as blank.
                    const amount = toAmountOrNull(raw);
                    update(
                      "lifetimeExemptionCap",
                      raw,
                      amount === "0" ? null : amount,
                    );
                  }}
                />
              </Row>
            </Card>

            <Card
              title="Prior lifetime gifts"
              help="Post-1976 cumulative taxable gifts before plan start. Pull from the most recent Form 709's 'prior periods' line. Joint pre-plan gifts are pre-attributed (a $200K joint gift = $100K on each spouse)."
            >
              <Row
                label={clientFirstName ?? "Client"}
                htmlFor="priorTaxableGiftsClient"
                help={`Cumulative post-1976 taxable gifts ${clientFirstName ?? "the client"} made before the plan starts. Reduces the federal exemption available at death.`}
              >
                <CurrencyInput
                  id="priorTaxableGiftsClient"
                  value={values.priorTaxableGiftsClient}
                  onChange={(raw) => update("priorTaxableGiftsClient", raw, toAmount(raw))}
                />
              </Row>
              {hasSpouse && (
                <Row
                  label={spouseFirstName ?? "Spouse"}
                  htmlFor="priorTaxableGiftsSpouse"
                  help={`Cumulative post-1976 taxable gifts ${spouseFirstName ?? "the spouse"} made before the plan starts. Reduces the federal exemption available at death.`}
                >
                  <CurrencyInput
                    id="priorTaxableGiftsSpouse"
                    value={values.priorTaxableGiftsSpouse}
                    onChange={(raw) => update("priorTaxableGiftsSpouse", raw, toAmount(raw))}
                  />
                </Row>
              )}
            </Card>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
