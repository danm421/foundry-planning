"use client";

import {
  defaultInheritedPayoutWindow,
  describeInheritedPayoutWindow,
  describeInheritedRule,
  ownerHadStartedRmds,
  resolveInheritedRule,
  type InheritedIraRule,
} from "@/engine/inherited-ira";
import { fieldLabelClassName, inputClassName } from "./input-styles";

export interface InheritedIraFieldsProps {
  isRoth: boolean;
  inherited: boolean;
  onInheritedChange: (value: boolean) => void;
  deathYear: string;
  onDeathYearChange: (value: string) => void;
  ownerBirthYear: string;
  onOwnerBirthYearChange: (value: string) => void;
  heirDisabled: boolean;
  onHeirDisabledChange: (value: boolean) => void;
  /** The heir's birth year (the client or spouse holding the account); null when unknown. */
  heirBirthYear: number | null;
  /** First plan year — the year the summary quotes a stretch divisor for. */
  referenceYear: number;
  /** Why the box can't be ticked (the IRA isn't the client's or spouse's). */
  unavailableReason: string | null;
  /** Validation message for the entered years, or null. */
  error: string | null;
  /** "Minimum each year" (no window) or "Spread payouts evenly". */
  payoutPlan: "minimum" | "even";
  onPayoutPlanChange: (value: "minimum" | "even") => void;
  payoutFromYear: string;
  onPayoutFromYearChange: (value: string) => void;
  payoutThroughYear: string;
  onPayoutThroughYearChange: (value: string) => void;
  /** Validation message for the payout window, or null. Shown under the window. */
  payoutError: string | null;
}

/** SECURE Act beneficiary classes only exist for deaths from this year. */
const SECURE_ACT_FIRST_DEATH_YEAR = 2020;
const checkboxClassName = "h-4 w-4 rounded border-hair-3 bg-card-2 text-accent focus:ring-accent";
const radioClassName = "h-4 w-4 border-hair-3 bg-card-2 text-accent focus:ring-accent";

function parseYear(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function InheritedIraFields(props: InheritedIraFieldsProps) {
  const death = parseYear(props.deathYear);
  const ownerBirth = parseYear(props.ownerBirthYear);

  let ageHint: string | null = null;
  let summary: string | null = null;
  const yearsValid = death != null && ownerBirth != null && props.error == null;
  let rule: InheritedIraRule | null = null;
  if (death != null && ownerBirth != null && props.error == null) {
    const started = ownerHadStartedRmds(ownerBirth, death, props.isRoth);
    ageHint = `Age ${death - ownerBirth} at death · ${started ? "had started RMDs" : "had not started RMDs"}`;
    if (props.heirBirthYear != null) {
      const input = {
        deathYear: death,
        ownerBirthYear: ownerBirth,
        heirBirthYear: props.heirBirthYear,
        heirDisabled: props.heirDisabled,
        isRoth: props.isRoth,
      };
      rule = resolveInheritedRule(input);
      summary = describeInheritedRule(input, rule, props.referenceYear);
    }
  }

  const minimumHint =
    rule == null ? null
    : rule.finalYear != null ? `The rest comes out in ${rule.finalYear}.`
    : "Over the heir's life expectancy.";
  const payoutFrom = parseYear(props.payoutFromYear);
  const payoutThrough = parseYear(props.payoutThroughYear);
  const payoutPreview =
    props.payoutPlan === "even" && props.payoutError == null && payoutFrom != null && payoutThrough != null && payoutFrom <= payoutThrough
      ? describeInheritedPayoutWindow({ fromYear: payoutFrom, throughYear: payoutThrough }, rule?.finalYear ?? null)
      : null;

  // Picking the window pre-fills it once: the first payout year (the later of
  // the plan's first year and the year after death) and, under the 10-year
  // rule, the deadline. Years the advisor already typed are kept.
  const chooseEvenPayouts = () => {
    props.onPayoutPlanChange("even");
    if (death == null || props.payoutFromYear.trim() !== "" || props.payoutThroughYear.trim() !== "") return;
    const prefill = defaultInheritedPayoutWindow(death, rule?.finalYear ?? null, props.referenceYear);
    props.onPayoutFromYearChange(String(prefill.fromYear));
    if (prefill.throughYear != null) props.onPayoutThroughYearChange(String(prefill.throughYear));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.inherited}
            disabled={props.unavailableReason != null && !props.inherited}
            onChange={(e) => props.onInheritedChange(e.target.checked)}
            className={checkboxClassName}
          />
          <span className="text-sm font-medium text-ink-3">Inherited from someone other than a spouse</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-ink-3">
          {props.unavailableReason ?? "Uses the beneficiary payout rules instead of the heir's own RMDs."}
        </p>
      </div>

      {props.inherited && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabelClassName} htmlFor="inheritedDeathYear">Year of death</label>
              <input
                id="inheritedDeathYear"
                inputMode="numeric"
                className={inputClassName}
                value={props.deathYear}
                placeholder="e.g. 2022"
                onChange={(e) => props.onDeathYearChange(e.target.value)}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="inheritedOwnerBirthYear">
                Original owner&apos;s birth year
              </label>
              <input
                id="inheritedOwnerBirthYear"
                inputMode="numeric"
                className={inputClassName}
                value={props.ownerBirthYear}
                placeholder="e.g. 1945"
                onChange={(e) => props.onOwnerBirthYearChange(e.target.value)}
              />
            </div>
          </div>

          {props.error != null ? (
            <p role="alert" className="text-xs text-warn">{props.error}</p>
          ) : (
            ageHint != null && <p className="text-xs text-ink-3">{ageHint}</p>
          )}

          {death != null && death >= SECURE_ACT_FIRST_DEATH_YEAR && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={props.heirDisabled}
                onChange={(e) => props.onHeirDisabledChange(e.target.checked)}
                className={checkboxClassName}
              />
              <span className="text-sm text-ink-3">Heir is disabled or chronically ill</span>
            </label>
          )}

          {yearsValid && (
            <>
              <p
                data-testid="inherited-rule-summary"
                className="rounded-[var(--radius-sm)] border border-hair-3 bg-card-2 px-3 py-2 text-[13px] text-ink-2"
              >
                {summary ?? "Add the heir's date of birth to preview the payout rule."}
              </p>

              <fieldset className="space-y-2">
                <legend className={fieldLabelClassName}>Payout plan</legend>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="inheritedPayoutPlan"
                      checked={props.payoutPlan === "minimum"}
                      onChange={() => props.onPayoutPlanChange("minimum")}
                      className={radioClassName}
                    />
                    <span className="text-sm text-ink-3">Minimum each year</span>
                  </label>
                  {minimumHint != null && <p className="mt-1 ml-6 text-xs text-ink-3">{minimumHint}</p>}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="inheritedPayoutPlan"
                    checked={props.payoutPlan === "even"}
                    onChange={chooseEvenPayouts}
                    className={radioClassName}
                  />
                  <span className="text-sm text-ink-3">Spread payouts evenly</span>
                </label>
                {props.payoutPlan === "even" && (
                  <div className="ml-6 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={fieldLabelClassName} htmlFor="inheritedPayoutFromYear">From</label>
                        <input
                          id="inheritedPayoutFromYear"
                          inputMode="numeric"
                          className={inputClassName}
                          value={props.payoutFromYear}
                          onChange={(e) => props.onPayoutFromYearChange(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={fieldLabelClassName} htmlFor="inheritedPayoutThroughYear">Through</label>
                        <input
                          id="inheritedPayoutThroughYear"
                          inputMode="numeric"
                          className={inputClassName}
                          value={props.payoutThroughYear}
                          onChange={(e) => props.onPayoutThroughYearChange(e.target.value)}
                        />
                      </div>
                    </div>
                    {props.payoutError != null ? (
                      <p role="alert" className="text-xs text-warn">{props.payoutError}</p>
                    ) : (
                      payoutPreview != null && (
                        <p data-testid="inherited-payout-preview" className="text-xs text-ink-3">{payoutPreview}</p>
                      )
                    )}
                  </div>
                )}
              </fieldset>
            </>
          )}
        </div>
      )}
    </div>
  );
}
