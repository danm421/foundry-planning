"use client";

import { useEffect, useRef } from "react";
import { CurrencyInput } from "./currency-input";
import type {
  InsurancePanelEntity,
  InsurancePanelModelPortfolio,
} from "./insurance-panel";
import type { PolicyFormState } from "./insurance-policy-dialog";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "./forms/input-styles";

interface InsurancePolicyDetailsTabProps {
  state: PolicyFormState;
  onChange: (patch: Partial<PolicyFormState>) => void;
  entities: InsurancePanelEntity[];
  modelPortfolios: InsurancePanelModelPortfolio[];
  resolvedInflationRate: number;
  mode: "create" | "edit";
  clientFirstName: string;
  spouseFirstName: string | null;
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
  entities,
  modelPortfolios,
  resolvedInflationRate,
  mode,
  clientFirstName,
  spouseFirstName,
}: InsurancePolicyDetailsTabProps) {
  const isTerm = state.policyType === "term";
  const trustEntities = entities.filter((e) => e.entityType === "trust");
  const spouseLabel = spouseFirstName ?? "Spouse";

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
                onChange={(e) => onChange({ name: e.target.value })}
                className={inputClassName}
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                value={state.owner}
                onChange={(e) =>
                  onChange({ owner: e.target.value as PolicyFormState["owner"] })
                }
                className={selectClassName}
              >
                <option value="client">{clientFirstName}</option>
                <option value="spouse" disabled={!spouseFirstName}>{spouseLabel}</option>
                <option value="joint">Joint</option>
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelClassName}>Owning entity (trust)</span>
              <select
                value={state.ownerEntityId ?? ""}
                onChange={(e) =>
                  onChange({ ownerEntityId: e.target.value || null })
                }
                disabled={trustEntities.length === 0}
                className={selectClassName}
              >
                <option value="">Individual owner</option>
                {trustEntities.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                  </option>
                ))}
              </select>
              {trustEntities.length === 0 && (
                <p className={helpCls}>No trusts available</p>
              )}
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
        <h3 className={sectionTitleCls}>Premium & basis</h3>
        <div className={gridTwoCls}>
          <label className="block">
            <span className={fieldLabelClassName}>Annual premium</span>
            <CurrencyInput
              value={state.premiumAmount}
              onChange={(raw) => onChange({ premiumAmount: toNumber(raw) })}
              className={inputClassName}
            />
            <p className={helpCls}>Annual premium paid by the owner.</p>
          </label>
          <label className="block">
            <span className={fieldLabelClassName}>Premium payment years</span>
            <input
              type="number"
              min={1}
              value={state.premiumYears ?? ""}
              onChange={(e) =>
                onChange({ premiumYears: toNullableInt(e.target.value) })
              }
              className={inputClassName}
            />
            <p className={helpCls}>Leave empty for ongoing.</p>
          </label>
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
