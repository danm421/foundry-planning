"use client";

import { useEffect, useRef } from "react";
import { CurrencyInput } from "./currency-input";
import type {
  InsurancePanelEntity,
  InsurancePanelFamilyMember,
  InsurancePanelExternal,
  InsurancePanelModelPortfolio,
} from "./insurance-panel";
import type { PolicyFormState } from "./insurance-policy-dialog";
import { isOwnerPrincipal } from "./insurance-policy-dialog";
import type { OwnerRef } from "@/lib/insurance-policies/owner-ref";
import type { ClientMilestones } from "@/lib/milestones";
import MilestoneYearPicker from "./milestone-year-picker";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "./forms/input-styles";

interface InsurancePolicyDetailsTabProps {
  state: PolicyFormState;
  onChange: (patch: Partial<PolicyFormState>) => void;
  familyMembers: InsurancePanelFamilyMember[];
  entities: InsurancePanelEntity[];
  externalBeneficiaries: InsurancePanelExternal[];
  modelPortfolios: InsurancePanelModelPortfolio[];
  resolvedInflationRate: number;
  /** Resolved client milestones for the activation-year picker. When absent the
   *  activation control is hidden (e.g. test fixtures without milestone data). */
  milestones?: ClientMilestones;
  mode: "create" | "edit";
  clientFirstName: string;
  spouseFirstName: string | null;
  /** Show the Name field as invalid (red border + aria-invalid). Cleared when
   *  the user types into it. */
  nameInvalid?: boolean;
}

// Coerce a number input value → number. Empty string becomes 0.
function toNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Coerce a number input value → number | null. Empty string becomes null.
function toNullableInt(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const helpCls = "mt-1 text-xs text-ink-4";
const sectionCls = "border-t border-hair pt-4 first:border-t-0 first:pt-0";
const sectionTitleCls = "mb-3 text-sm font-semibold text-ink-2";
const gridTwoCls = "grid grid-cols-1 gap-3 sm:grid-cols-2";

export default function InsurancePolicyDetailsTab({
  state,
  onChange,
  familyMembers,
  entities,
  externalBeneficiaries,
  modelPortfolios,
  resolvedInflationRate,
  milestones,
  mode,
  clientFirstName,
  spouseFirstName,
  nameInvalid,
}: InsurancePolicyDetailsTabProps) {
  const isTerm = state.policyType === "term";
  const currentYear = new Date().getFullYear();
  const spouseLabel = spouseFirstName ?? "Spouse";

  // Build the unified owner option list.
  //   Each option's `value` is a JSON-encoded OwnerRef so React can use a
  //   plain `<option value>` and we don't need a parallel id lookup. Keys
  //   in the JSON are stable across renders so React's reconciliation works.
  const clientFm = familyMembers.find((f) => f.role === "client") ?? null;
  const spouseFm = familyMembers.find((f) => f.role === "spouse") ?? null;
  const otherFms = familyMembers.filter(
    (f) => f.role !== "client" && f.role !== "spouse",
  );

  // The "Paid by" selector only matters when a gift could arise — i.e. the owner
  // is NOT a household principal (a trust/entity, an external person, or a
  // non-principal family member). Principal- and joint-owned policies are funded
  // by the household directly, so there is no gift and the field is hidden.
  const ownerRef = state.ownerRef;
  const ownerIsPrincipal = isOwnerPrincipal(ownerRef, clientFm?.id, spouseFm?.id);
  const showPaidBy = !ownerIsPrincipal;

  // Owner label + Crummey state, for the helper line under "Paid by".
  const ownerEntity =
    ownerRef.kind === "entity" ? entities.find((e) => e.id === ownerRef.id) ?? null : null;
  const paidByOwnerLabel =
    ownerRef.kind === "entity"
      ? ownerEntity?.name ?? "the owner"
      : ownerRef.kind === "external"
      ? externalBeneficiaries.find((x) => x.id === ownerRef.id)?.name ?? "the owner"
      : ownerRef.kind === "family"
      ? otherFms.find((f) => f.id === ownerRef.id)?.firstName ?? "the owner"
      : "the owner";
  const paidByHelp =
    state.premiumPayer === "owner"
      ? "Premiums are paid by the owner."
      : `Premiums are treated as gifts to ${paidByOwnerLabel}` +
        (ownerEntity
          ? ownerEntity.crummeyPowers
            ? " (annual-exclusion / Crummey)."
            : " (uses lifetime exemption)."
          : ".");

  function refToValue(ref: OwnerRef): string {
    return JSON.stringify(ref);
  }
  function valueToRef(v: string): OwnerRef {
    return JSON.parse(v) as OwnerRef;
  }

  // Auto-focus + select-all the Name input on create so the advisor can start
  // typing to replace the auto-default ("{Owner} - {Type}") immediately.
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (mode !== "create") return;
    const el = nameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [mode]);

  // Growth-source dropdown value: "mp:<id>" for portfolios, otherwise "inflation" / "custom".
  const growthSelectValue =
    state.postPayoutGrowthSource === "model_portfolio" && state.postPayoutModelPortfolioId
      ? `mp:${state.postPayoutModelPortfolioId}`
      : state.postPayoutGrowthSource;

  function handleGrowthSourceChange(value: string) {
    if (value.startsWith("mp:")) {
      const id = value.slice(3);
      const portfolio = modelPortfolios.find((p) => p.id === id);
      onChange({
        postPayoutGrowthSource: "model_portfolio",
        postPayoutModelPortfolioId: id,
        // Keep growthRate aligned with portfolio's blended return so the
        // standalone fallback (if a portfolio is later removed) is sensible.
        postPayoutGrowthRate: portfolio?.blendedReturn ?? state.postPayoutGrowthRate,
      });
    } else if (value === "inflation") {
      onChange({
        postPayoutGrowthSource: "inflation",
        postPayoutModelPortfolioId: null,
        postPayoutGrowthRate: resolvedInflationRate,
      });
    } else {
      onChange({
        postPayoutGrowthSource: "custom",
        postPayoutModelPortfolioId: null,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {/* ── Basic info ─────────────────────────────────────────────── */}
      <section className={sectionCls}>
        <h3 className={sectionTitleCls}>Basic info</h3>
        <div className="flex flex-col gap-3">
          <div className={gridTwoCls}>
            <label className="block">
              <span className={fieldLabelClassName}>Name</span>
              <input
                ref={nameInputRef}
                type="text"
                required
                value={state.name}
                aria-invalid={nameInvalid || undefined}
                onChange={(e) => onChange({ name: e.target.value })}
                className={
                  nameInvalid
                    ? `${inputClassName} !border-crit focus:!border-crit`
                    : inputClassName
                }
              />
            </label>
            <label className="block">
              <span className={fieldLabelClassName}>Policy type</span>
              <select
                value={state.policyType}
                onChange={(e) =>
                  onChange({
                    policyType: e.target.value as PolicyFormState["policyType"],
                  })
                }
                className={selectClassName}
              >
                <option value="term">Term</option>
                <option value="whole">Whole Life</option>
                <option value="universal">Universal Life</option>
                <option value="variable">Variable Life</option>
              </select>
            </label>
          </div>

          {isTerm && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={fieldLabelClassName}>Term issue year</span>
                <input
                  type="number"
                  min={1900}
                  max={2200}
                  value={state.termIssueYear ?? ""}
                  onChange={(e) =>
                    onChange({ termIssueYear: toNullableInt(e.target.value) })
                  }
                  className={inputClassName}
                  required
                />
              </label>
              {!state.endsAtInsuredRetirement && (
                <label className="block">
                  <span className={fieldLabelClassName}>Term length (years)</span>
                  <input
                    type="number"
                    min={1}
                    value={state.termLengthYears ?? ""}
                    onChange={(e) =>
                      onChange({ termLengthYears: toNullableInt(e.target.value) })
                    }
                    className={inputClassName}
                    required
                  />
                </label>
              )}
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2 sm:col-start-3">
                <input
                  type="checkbox"
                  checked={state.endsAtInsuredRetirement === true}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? { endsAtInsuredRetirement: true, termLengthYears: null }
                        : { endsAtInsuredRetirement: false },
                    )
                  }
                />
                <span>Term ends at insured&apos;s retirement</span>
              </label>
            </div>
          )}

          {milestones && (
            <div className="max-w-xs">
              <MilestoneYearPicker
                id="li-activationYear"
                name="li-activationYear"
                label="Activates (policy purchased)"
                value={state.activationYear ?? currentYear}
                yearRef={state.activationYearRef}
                milestones={milestones}
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName ?? undefined}
                position="start"
                onChange={(y, ref) => {
                  // For term policies, keep the issue year in lockstep with the
                  // resolved activation year — whether activation is a plain
                  // calendar year or a milestone-anchored one — so term-length
                  // math and coverage-start agree.
                  const patch: Partial<PolicyFormState> = {
                    activationYear: y,
                    activationYearRef: ref,
                  };
                  if (state.policyType === "term") {
                    patch.termIssueYear = y;
                  }
                  onChange(patch);
                }}
              />
              <p className={helpCls}>
                Leave at the current year for an existing policy; set a future
                year to model buying it later.
              </p>
            </div>
          )}

          <div className={gridTwoCls}>
            <label className="block">
              <span className={fieldLabelClassName}>Insured person</span>
              <select
                value={state.insuredPerson}
                onChange={(e) =>
                  onChange({
                    insuredPerson: e.target.value as PolicyFormState["insuredPerson"],
                  })
                }
                className={selectClassName}
              >
                <option value="client">{clientFirstName}</option>
                <option value="spouse" disabled={!spouseFirstName}>{spouseLabel}</option>
                <option value="joint">Joint</option>
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelClassName}>Owner</span>
              <select
                value={refToValue(state.ownerRef)}
                onChange={(e) => onChange({ ownerRef: valueToRef(e.target.value) })}
                className={selectClassName}
              >
                <optgroup label="Individuals">
                  {clientFm && (
                    <option value={refToValue({ kind: "family", id: clientFm.id })}>
                      {clientFirstName}
                    </option>
                  )}
                  {spouseFm && (
                    <option value={refToValue({ kind: "family", id: spouseFm.id })}>
                      {spouseLabel}
                    </option>
                  )}
                  {clientFm && spouseFm && (
                    <option value={refToValue({ kind: "joint" })}>
                      Joint ({clientFirstName} & {spouseLabel})
                    </option>
                  )}
                  {otherFms.map((fm) => (
                    <option
                      key={fm.id}
                      value={refToValue({ kind: "family", id: fm.id })}
                    >
                      {fm.firstName}{fm.lastName ? ` ${fm.lastName}` : ""}
                    </option>
                  ))}
                </optgroup>
                {externalBeneficiaries.length > 0 && (
                  <optgroup label="External beneficiaries">
                    {externalBeneficiaries.map((x) => (
                      <option
                        key={x.id}
                        value={refToValue({ kind: "external", id: x.id })}
                      >
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {entities.length > 0 && (
                  <optgroup label="Trusts">
                    {entities.map((en) => (
                      <option
                        key={en.id}
                        value={refToValue({ kind: "entity", id: en.id })}
                      >
                        {en.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>

          <div className={isTerm ? gridTwoCls : "grid grid-cols-1 gap-3 sm:grid-cols-3"}>
            <label className="block">
              <span className={fieldLabelClassName}>Death benefit</span>
              <CurrencyInput
                value={state.faceValue}
                onChange={(raw) => onChange({ faceValue: toNumber(raw) })}
                className={inputClassName}
                required
              />
            </label>
            {!isTerm && (
              <>
                <label className="block">
                  <span className={fieldLabelClassName}>Current cash value</span>
                  <CurrencyInput
                    value={state.cashValue}
                    onChange={(raw) => onChange({ cashValue: toNumber(raw) })}
                    className={inputClassName}
                  />
                  <p className={helpCls}>Current cash surrender value.</p>
                </label>
                <label className="block">
                  <span className={fieldLabelClassName}>Cost basis</span>
                  <CurrencyInput
                    value={state.costBasis}
                    onChange={(raw) => onChange({ costBasis: toNumber(raw) })}
                    className={inputClassName}
                  />
                  <p className={helpCls}>
                    Cumulative premiums paid (reduces taxable gain on surrender).
                  </p>
                </label>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Premium & basis ────────────────────────────────────────── */}
      <section className={sectionCls}>
        <h3 className={sectionTitleCls}>Premium &amp; basis</h3>
        <div className={showPaidBy ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : gridTwoCls}>
          <label className="block">
            <span className={fieldLabelClassName}>Annual premium</span>
            <CurrencyInput
              value={state.premiumAmount}
              onChange={(raw) => onChange({ premiumAmount: toNumber(raw) })}
              className={inputClassName}
            />
            <p className={helpCls}>Annual premium amount.</p>
          </label>
          <label className="block">
            <span className={fieldLabelClassName}>Premium payment years</span>
            <input
              type="number"
              min={1}
              value={state.premiumYears ?? ""}
              onChange={(e) => onChange({ premiumYears: toNullableInt(e.target.value) })}
              className={inputClassName}
            />
            <p className={helpCls}>Leave empty for ongoing.</p>
          </label>
          {showPaidBy && (
            <label className="block">
              <span className={fieldLabelClassName}>Paid by</span>
              <select
                value={state.premiumPayer}
                onChange={(e) =>
                  onChange({ premiumPayer: e.target.value as PolicyFormState["premiumPayer"] })
                }
                className={selectClassName}
              >
                <option value="owner">Owner</option>
                <option value="client">{clientFirstName}</option>
                <option value="spouse" disabled={!spouseFirstName}>{spouseLabel}</option>
                <option value="both" disabled={!spouseFirstName}>Both</option>
              </select>
              <p className={helpCls}>{paidByHelp}</p>
            </label>
          )}
        </div>
      </section>

      {/* ── Post-payout routing ────────────────────────────────────── */}
      <section className={sectionCls}>
        <h3 className={sectionTitleCls}>Post-payout proceeds account</h3>
        <p className="mb-3 text-xs text-ink-3">
          When the policy pays out (death benefit for term, full surrender for
          permanent), proceeds land in a new standalone account that grows at
          the rate selected here.
        </p>
        <div className={gridTwoCls}>
          <label className="block">
            <span className={fieldLabelClassName}>Growth rate</span>
            <select
              value={growthSelectValue}
              onChange={(e) => handleGrowthSourceChange(e.target.value)}
              className={selectClassName}
            >
              {modelPortfolios.map((p) => (
                <option key={p.id} value={`mp:${p.id}`}>
                  {(p.blendedReturn * 100).toFixed(2)}% — {p.name}
                </option>
              ))}
              <option value="inflation">
                {(resolvedInflationRate * 100).toFixed(2)}% — Inflation rate
              </option>
              <option value="custom">Custom %</option>
            </select>
            {state.postPayoutGrowthSource === "model_portfolio" && (
              <p className={helpCls}>
                Proceeds account uses this portfolio&apos;s CMA for growth and tax
                realization.
              </p>
            )}
            {state.postPayoutGrowthSource === "inflation" && (
              <p className={helpCls}>
                Tracks plan inflation rate at save time:{" "}
                {(resolvedInflationRate * 100).toFixed(2)}%.
              </p>
            )}
          </label>
          {state.postPayoutGrowthSource === "custom" && (
            <label className="block">
              <span className={fieldLabelClassName}>Custom rate</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.001}
                value={state.postPayoutGrowthRate}
                onChange={(e) =>
                  onChange({ postPayoutGrowthRate: toNumber(e.target.value) })
                }
                className={inputClassName}
              />
              <p className={helpCls}>As a decimal — 0.06 = 6%.</p>
            </label>
          )}
        </div>
      </section>
    </div>
  );
}
