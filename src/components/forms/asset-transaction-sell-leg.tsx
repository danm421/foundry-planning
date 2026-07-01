"use client";

import { useMemo } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import type { ProjectionYear } from "@/engine/types";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import type { SellLegDraft } from "./asset-transaction-leg-model";
import { parseNum, formatCurrency } from "./asset-transaction-leg-model";
import type { BusinessSaleOption } from "./add-asset-transaction-form";

// ── Local icon (only used by §121 toggle in this component) ──────────────────

/** 12×12 check glyph for the §121 toggle. */
function CheckIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2.5 6.2 5 8.7l4.5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SellLegEditorProps {
  leg: SellLegDraft;
  year: number;
  onChange: (patch: Partial<SellLegDraft>) => void;
  accounts: { id: string; name: string; category: string; subType: string }[];
  liabilities: { id: string; name: string; linkedPropertyId: string | null; balance: string }[];
  businesses: BusinessSaleOption[];
  pastBuys: { id: string; name: string; assetName: string | null; year: number; assetCategory: string | null }[];
  projectionYears: ProjectionYear[] | null;
  isOrphan?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SellLegEditor({
  leg,
  year,
  onChange,
  accounts,
  liabilities,
  businesses,
  pastBuys,
  projectionYears,
  isOrphan,
}: SellLegEditorProps) {
  // ── Derived state ─────────────────────────────────────────────────────────

  // Look up projected value and basis for the sell account in the selected year.
  // Sales run BoY in the engine, so BoY snapshots are exactly what the engine uses.
  const projectedSellInfo = useMemo(() => {
    if (!projectionYears || !leg.sellAccountId || !year) return null;
    const projYear = projectionYears.find((py) => py.year === year);
    if (!projYear) return null;
    const ledger = projYear.accountLedgers[leg.sellAccountId];
    if (!ledger) return null;
    const projectedBasis = projYear.accountBasisBoY?.[leg.sellAccountId] ?? null;
    return {
      projectedValue: ledger.beginningValue,
      projectedBasis,
    };
  }, [projectionYears, leg.sellAccountId, year]);

  // Linked mortgage for sell side
  const linkedMortgage = leg.sellAccountId
    ? liabilities.find((l) => l.linkedPropertyId === leg.sellAccountId)
    : null;

  // Projected mortgage balance from the projection at BoY of the sale year
  const projectedMortgageBalance = useMemo(() => {
    if (!projectionYears || !linkedMortgage || !year) return null;
    const projYear = projectionYears.find((py) => py.year === year);
    if (!projYear) return null;
    const bal = projYear.liabilityBalancesBoY?.[linkedMortgage.id];
    return bal != null ? bal : null;
  }, [projectionYears, linkedMortgage, year]);

  // Selected sell account info
  const sellAccount = accounts.find((a) => a.id === leg.sellAccountId);
  const isSellRealEstate = sellAccount?.category === "real_estate";

  // Selected business for cascade preview card
  const selectedBusiness = businesses.find((b) => b.id === leg.sellBusinessAccountId);

  // The synthetic id used by the engine when a sell points at a prior buy is
  // `technique-acct-${buy.id}`. Liabilities can be linked to those ids.
  const selectedAccountId =
    leg.sellAccountId ||
    (leg.sellPurchaseTransactionId ? `technique-acct-${leg.sellPurchaseTransactionId}` : "");
  const selectedHasMortgage =
    !!selectedAccountId &&
    liabilities.some((l) => l.linkedPropertyId === selectedAccountId);

  // Proceeds accounts: only cash or taxable
  const proceedsAccountOptions = useMemo(
    () => accounts.filter((a) => a.category === "cash" || a.category === "taxable"),
    [accounts],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Orphan warning */}
      {isOrphan && (
        <p className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">
          Source removed — please re-select. The buy transaction this
          sell referenced was deleted.
        </p>
      )}

      {/* Sell-source picker: account vs business. Hidden when no sellable businesses exist. */}
      {businesses.length > 0 && (
        <div>
          <label className={fieldLabelClassName}>Sell source</label>
          <div className="flex gap-1.5">
            {(
              [
                { id: "account", label: "Account" },
                { id: "business", label: "Business" },
              ] as const
            ).map((opt) => {
              const active = leg.sellMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    if (opt.id === "business") {
                      onChange({
                        sellMode: "business",
                        sellAccountId: "",
                        sellPurchaseTransactionId: "",
                        // $-amount mode doesn't apply to business sales
                        sellAmountMode: leg.sellAmountMode === "dollar" ? "full" : leg.sellAmountMode,
                      });
                    } else {
                      onChange({ sellMode: "account", sellBusinessAccountId: "" });
                    }
                  }}
                  aria-pressed={active}
                  className={
                    "rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] font-medium transition-colors " +
                    (active
                      ? "border-accent/50 bg-accent/10 text-accent-ink"
                      : "border-hair bg-card-2 text-ink-2 hover:border-hair-2")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Business select + cascade preview card */}
      {leg.sellMode === "business" && (
        <div className="space-y-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="sellBusinessAccountId">
              Business to Sell
            </label>
            <select
              id="sellBusinessAccountId"
              value={leg.sellBusinessAccountId}
              onChange={(e) => onChange({ sellBusinessAccountId: e.target.value })}
              className={selectClassName}
            >
              <option value="">-- Select business --</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.businessTypeLabel})
                </option>
              ))}
            </select>
          </div>

          {selectedBusiness && (
            <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2/40 p-3 text-[12px] space-y-2">
              <div className="flex justify-between font-medium">
                <span>
                  {selectedBusiness.name} ({selectedBusiness.businessTypeLabel})
                </span>
                <span className="tabular-nums">
                  Value {formatCurrency(selectedBusiness.value)}
                </span>
              </div>
              <div className="text-ink-2">
                Basis{" "}
                <span className="tabular-nums">
                  {formatCurrency(selectedBusiness.basis)}
                </span>
              </div>
              {selectedBusiness.owners.length > 0 && (
                <div>
                  <div className="font-semibold text-ink-3 mb-1">Owners</div>
                  <ul className="space-y-0.5">
                    {selectedBusiness.owners.map((o) => (
                      <li key={o.familyMemberId}>
                        {o.familyMemberName} —{" "}
                        {(o.percent * 100).toFixed(1)}%
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedBusiness.childAccounts.length > 0 && (
                <div>
                  <div className="font-semibold text-ink-3 mb-1">
                    Cascades to child accounts
                  </div>
                  <ul className="space-y-0.5">
                    {selectedBusiness.childAccounts.map((a) => (
                      <li key={a.id} className="tabular-nums">
                        {a.name} — {formatCurrency(a.currentValue)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedBusiness.childLiabilities.length > 0 && (
                <div>
                  <div className="font-semibold text-ink-3 mb-1">
                    Cascades to child liabilities
                  </div>
                  <ul className="space-y-0.5">
                    {selectedBusiness.childLiabilities.map((l) => (
                      <li key={l.id} className="tabular-nums">
                        {l.name} — {formatCurrency(l.currentBalance)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-ink-3 italic">
                Net proceeds will be deposited to the household default
                checking account.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Account / past-buy select (account mode only) */}
      {leg.sellMode === "account" && (
        <div>
          <label className={fieldLabelClassName} htmlFor="sellAccountId">
            Account to Sell
          </label>
          <select
            id="sellAccountId"
            value={
              leg.sellAccountId ||
              (leg.sellPurchaseTransactionId
                ? `buy:${leg.sellPurchaseTransactionId}`
                : "")
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("buy:")) {
                onChange({ sellPurchaseTransactionId: v.slice(4), sellAccountId: "" });
              } else {
                onChange({ sellAccountId: v, sellPurchaseTransactionId: "" });
              }
            }}
            className={selectClassName}
          >
            <option value="">-- Select source --</option>
            <optgroup label="Existing accounts">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
            {pastBuys.filter((b) => b.year < year).length > 0 && (
              <optgroup label="Bought via transaction">
                {pastBuys
                  .filter((b) => b.year < year)
                  .map((b) => (
                    <option key={b.id} value={`buy:${b.id}`}>
                      {b.assetName ?? b.name} (buy {b.year})
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      {/* Sell amount mode buttons + percent input + mortgage warning */}
      <div>
        <label className={fieldLabelClassName}>Sell amount</label>
        <div className="flex gap-1.5">
          {(
            leg.sellMode === "business"
              ? (["full", "percent"] as const)
              : (["full", "percent", "dollar"] as const)
          ).map((m) => {
            const active = leg.sellAmountMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ sellAmountMode: m })}
                aria-pressed={active}
                className={
                  "rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] font-medium transition-colors " +
                  (active
                    ? "border-accent/50 bg-accent/10 text-accent-ink"
                    : "border-hair bg-card-2 text-ink-2 hover:border-hair-2")
                }
              >
                {m === "full"
                  ? "Full sale"
                  : m === "percent"
                  ? "% of asset"
                  : "$ amount"}
              </button>
            );
          })}
        </div>
        {leg.sellAmountMode === "percent" && (
          <div className="mt-2">
            <PercentInput
              value={leg.fractionSoldPct}
              onChange={(raw) => onChange({ fractionSoldPct: raw })}
              className={`${inputClassName} w-32`}
            />
          </div>
        )}
        {selectedHasMortgage && leg.sellAmountMode !== "full" && (
          <p className="mt-2 text-[12px] text-warn">
            Linked mortgage will not be paid off on a partial sale.
          </p>
        )}
      </div>

      {/* Sale value / basis: dollar-mode inline vs More overrides */}
      {leg.sellAmountMode === "dollar" ? (
        <div>
          <label className={fieldLabelClassName} htmlFor="overrideSaleValue">
            Sell amount ($)
          </label>
          <CurrencyInput
            id="overrideSaleValue"
            value={leg.overrideSaleValue}
            onChange={(raw) => onChange({ overrideSaleValue: raw })}
            placeholder="Leave blank for projected"
            className={inputClassName.replace("px-3", "pr-3")}
          />
          {projectedSellInfo && projectedSellInfo.projectedValue > 0 && (
            <p className="mt-1 text-[12px] text-ink-3">
              Projected value in {year}:{" "}
              <span className="text-ink-2 tabular-nums">
                {formatCurrency(projectedSellInfo.projectedValue)}
              </span>
            </p>
          )}
          <div className="mt-3">
            <label className={fieldLabelClassName} htmlFor="overrideBasis">
              Override Basis ($)
            </label>
            <CurrencyInput
              id="overrideBasis"
              value={leg.overrideBasis}
              onChange={(raw) => onChange({ overrideBasis: raw })}
              placeholder="Leave blank for projected"
              className={inputClassName.replace("px-3", "pr-3")}
            />
            {projectedSellInfo && projectedSellInfo.projectedBasis != null && (
              <p className="mt-1 text-[12px] text-ink-3">
                Projected basis in {year}:{" "}
                <span className="text-ink-2 tabular-nums">
                  {formatCurrency(projectedSellInfo.projectedBasis)}
                </span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <details className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
          <summary className="cursor-pointer text-[13px] text-ink-2">
            More overrides
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <label className={fieldLabelClassName} htmlFor="overrideSaleValue">
                Override Sale Value ($)
              </label>
              <CurrencyInput
                id="overrideSaleValue"
                value={leg.overrideSaleValue}
                onChange={(raw) => onChange({ overrideSaleValue: raw })}
                placeholder="Leave blank for projected"
                className={inputClassName.replace("px-3", "pr-3")}
              />
              {projectedSellInfo && projectedSellInfo.projectedValue > 0 && (
                <p className="mt-1 text-[12px] text-ink-3">
                  Projected value in {year}:{" "}
                  <span className="text-ink-2 tabular-nums">
                    {formatCurrency(projectedSellInfo.projectedValue)}
                  </span>
                </p>
              )}
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="overrideBasis">
                Override Basis ($)
              </label>
              <CurrencyInput
                id="overrideBasis"
                value={leg.overrideBasis}
                onChange={(raw) => onChange({ overrideBasis: raw })}
                placeholder="Leave blank for projected"
                className={inputClassName.replace("px-3", "pr-3")}
              />
              {projectedSellInfo && projectedSellInfo.projectedBasis != null && (
                <p className="mt-1 text-[12px] text-ink-3">
                  Projected basis in {year}:{" "}
                  <span className="text-ink-2 tabular-nums">
                    {formatCurrency(projectedSellInfo.projectedBasis)}
                  </span>
                </p>
              )}
            </div>
          </div>
        </details>
      )}

      {/* Transaction costs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="transactionCostPct">
            Transaction Cost (%)
          </label>
          <PercentInput
            id="transactionCostPct"
            value={leg.transactionCostPct}
            onChange={(raw) => onChange({ transactionCostPct: raw })}
            placeholder="Optional"
            className={inputClassName}
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="transactionCostFlat">
            Transaction Cost ($)
          </label>
          <CurrencyInput
            id="transactionCostFlat"
            value={leg.transactionCostFlat}
            onChange={(raw) => onChange({ transactionCostFlat: raw })}
            placeholder="Optional"
            className={inputClassName.replace("px-3", "pr-3")}
          />
        </div>
      </div>

      {/* Linked mortgage payoff card — real estate only */}
      {isSellRealEstate && linkedMortgage && (
        <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          <div>
            <span className="font-medium">Linked Mortgage:</span>{" "}
            {linkedMortgage.name}
          </div>
          <div className="mt-0.5">
            Projected balance in {year}:{" "}
            <span className="tabular-nums">
              {formatCurrency(
                projectedMortgageBalance ?? parseNum(linkedMortgage.balance)
              )}
            </span>
          </div>
          <div className="mt-0.5 text-warn/70">Will be paid off at sale</div>
        </div>
      )}

      {/* IRC §121 home-sale exclusion toggle — real estate sells only */}
      {isSellRealEstate && (
        <button
          type="button"
          onClick={() =>
            onChange({ qualifiesForHomeSaleExclusion: !leg.qualifiesForHomeSaleExclusion })
          }
          aria-pressed={leg.qualifiesForHomeSaleExclusion}
          className={`flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors ${
            leg.qualifiesForHomeSaleExclusion
              ? "border-accent/50 bg-accent/10"
              : "border-hair bg-card-2 hover:border-hair-2"
          }`}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
              leg.qualifiesForHomeSaleExclusion
                ? "border-accent bg-accent text-accent-on"
                : "border-hair-2 bg-card"
            }`}
          >
            {leg.qualifiesForHomeSaleExclusion && <CheckIcon />}
          </span>
          <span>
            <span className="text-[13px] font-medium text-ink">
              Qualifies for home-sale gain exclusion (§121)
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
              Excludes up to $250k single / $500k married-joint of capital gain
              on this sale. Advisor confirms 2-of-5-year eligibility.
            </span>
          </span>
        </button>
      )}

      {/* Proceeds destination — hidden in business mode */}
      {/* Always shown in account mode; the ledger shell (parent) may suppress when proceeds fund a buy leg. */}
      {leg.sellMode !== "business" && (
        <div>
          <label className={fieldLabelClassName} htmlFor="proceedsAccountId">
            Proceeds Destination
          </label>
          <select
            id="proceedsAccountId"
            value={leg.proceedsAccountId}
            onChange={(e) => onChange({ proceedsAccountId: e.target.value })}
            className={selectClassName}
          >
            <option value="">Default Checking</option>
            {proceedsAccountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
