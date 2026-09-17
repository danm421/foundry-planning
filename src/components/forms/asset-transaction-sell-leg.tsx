"use client";

import { useMemo } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import type { ProjectionYear } from "@/engine/types";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { FieldTooltip } from "./field-tooltip";
import type { SellLegDraft } from "./asset-transaction-leg-model";
import { parseNum, formatCurrency, patchForSource } from "./asset-transaction-leg-model";
import {
  type BusinessSaleOption,
  type SellSourceAccount,
  businessTotalAssetValue,
  businessTotalDebt,
  sellableAccounts,
} from "@/lib/techniques/sell-source-options";

// ── Local icon (only used by §121 checkbox in this component) ─────────────────

/** 12×12 check glyph for the §121 checkbox. */
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

/** Segmented-control button styling. Selected reads as a filled accent chip so
 *  it's unmistakable which mode is active. */
function segmentClass(active: boolean): string {
  return (
    "rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] font-medium transition-colors " +
    (active
      ? "border-accent bg-accent/20 text-accent-ink font-semibold"
      : "border-hair bg-card-2 text-ink-2 hover:border-hair-2")
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SellLegEditorProps {
  leg: SellLegDraft;
  year: number;
  onChange: (patch: Partial<SellLegDraft>) => void;
  accounts: SellSourceAccount[];
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

  // Sources the advisor may point this leg at. Top-level businesses and the
  // auto-provisioned cash buckets of businesses/trusts are dropped — see
  // lib/techniques/sell-source-options.
  const accountOptions = useMemo(() => sellableAccounts(accounts), [accounts]);
  const sellablePastBuys = useMemo(
    () => pastBuys.filter((b) => b.year < year),
    [pastBuys, year],
  );

  // One dropdown drives three fields, so the option values are namespaced.
  const selectedSourceValue = leg.sellBusinessAccountId
    ? `biz:${leg.sellBusinessAccountId}`
    : leg.sellAccountId ||
      (leg.sellPurchaseTransactionId ? `buy:${leg.sellPurchaseTransactionId}` : "");

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

  // Pre-fill the value/basis fields with the projected figures for the sale
  // year (rounded to whole dollars). The stored override stays empty until the
  // user types over it, so an untouched field still uses the exact projection.
  // A business shows its OPERATING value, not the total — the engine sells the
  // accounts it owns separately and adds them on top, so typing the whole
  // enterprise value here would count them twice.
  const projValue = selectedBusiness
    ? selectedBusiness.value
    : projectedSellInfo?.projectedValue ?? null;
  const projBasis = selectedBusiness
    ? selectedBusiness.basis
    : projectedSellInfo?.projectedBasis ?? null;
  const saleValueDisplay =
    leg.overrideSaleValue !== ""
      ? leg.overrideSaleValue
      : projValue != null
        ? String(Math.round(projValue))
        : "";
  const basisDisplay =
    leg.overrideBasis !== ""
      ? leg.overrideBasis
      : projBasis != null
        ? String(Math.round(projBasis))
        : "";

  // Label variant that lays out inline so a FieldTooltip can sit beside the text.
  const tooltipLabelClass = `${fieldLabelClassName.replace("block", "flex")} items-center gap-1.5`;

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

      {/* One source dropdown: accounts, businesses, and prior buys. Picking a
          business writes `sellBusinessAccountId`, which routes the sale through
          the engine's cascade so everything the business owns goes with it. */}
      <div>
        <label className={fieldLabelClassName} htmlFor="sellAccountId">
          Asset to Sell
        </label>
        <select
          id="sellAccountId"
          value={selectedSourceValue}
          onChange={(e) => onChange(patchForSource(e.target.value, leg.sellAmountMode))}
          className={selectClassName}
        >
          <option value="">-- Select asset --</option>
          {businesses.length > 0 && (
            <optgroup label="Businesses (sells everything it owns)">
              {businesses.map((b) => (
                <option key={b.id} value={`biz:${b.id}`}>
                  {b.name} ({b.businessTypeLabel}) — {formatCurrency(businessTotalAssetValue(b))}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Accounts">
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.value != null ? ` — ${formatCurrency(a.value)}` : ""}
              </option>
            ))}
          </optgroup>
          {sellablePastBuys.length > 0 && (
            <optgroup label="Bought via transaction">
              {sellablePastBuys.map((b) => (
                <option key={b.id} value={`buy:${b.id}`}>
                  {b.assetName ?? b.name} (buy {b.year})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Cascade preview — what a business sale actually disposes of. */}
      {selectedBusiness && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2/40 p-3 text-[12px] space-y-2">
          <div className="flex justify-between font-medium">
            <span>
              {selectedBusiness.name} ({selectedBusiness.businessTypeLabel})
            </span>
            <span className="tabular-nums">
              Total assets {formatCurrency(businessTotalAssetValue(selectedBusiness))}
            </span>
          </div>
          <div className="flex justify-between text-ink-2">
            <span>Business itself (operating value)</span>
            <span className="tabular-nums">{formatCurrency(selectedBusiness.value)}</span>
          </div>
          {selectedBusiness.childAccounts.map((a) => (
            <div key={a.id} className="flex justify-between text-ink-2">
              <span>{a.name}</span>
              <span className="tabular-nums">{formatCurrency(a.currentValue)}</span>
            </div>
          ))}
          {selectedBusiness.childLiabilities.map((l) => (
            <div key={l.id} className="flex justify-between text-warn">
              <span>{l.name} (paid off)</span>
              <span className="tabular-nums">
                −{formatCurrency(l.currentBalance)}
              </span>
            </div>
          ))}
          {businessTotalDebt(selectedBusiness) > 0 && (
            <div className="flex justify-between border-t border-hair pt-1.5 font-medium">
              <span>Net of debt</span>
              <span className="tabular-nums">
                {formatCurrency(
                  businessTotalAssetValue(selectedBusiness) -
                    businessTotalDebt(selectedBusiness),
                )}
              </span>
            </div>
          )}
          {selectedBusiness.owners.length > 0 ? (
            <div>
              <div className="font-semibold text-ink-3 mb-1">Owners</div>
              <ul className="space-y-0.5">
                {selectedBusiness.owners.map((o) => (
                  <li key={o.familyMemberId}>
                    {o.familyMemberName} — {(o.percent * 100).toFixed(1)}%
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-2 py-1.5 text-crit">
              No owner is recorded on this business, so the sale will not run.
              Add an owner on the Balance Sheet first.
            </p>
          )}
          <div className="text-ink-3 italic">
            Net proceeds will be deposited to the household default checking
            account.
          </div>
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
                className={segmentClass(active)}
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

      {/* Sale value & basis in the sale year — pre-filled from the projection;
          type to override. In % mode the fraction drives the value, so only the
          basis is shown. */}
      {leg.sellAmountMode === "percent" ? (
        <div className="w-1/2 pr-2">
          <label className={tooltipLabelClass} htmlFor="overrideBasis">
            Basis ($)
            <FieldTooltip
              text={
                selectedBusiness
                  ? "Cost basis in the business itself. Each account it owns carries its own basis and is taxed separately."
                  : `Cost basis in ${year}, pre-filled from the projection. Type to override; used to compute the capital gain.`
              }
            />
          </label>
          <CurrencyInput
            id="overrideBasis"
            value={basisDisplay}
            onChange={(raw) => onChange({ overrideBasis: raw })}
            placeholder="Enter basis"
            className={inputClassName.replace("px-3", "pr-3")}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={tooltipLabelClass} htmlFor="overrideSaleValue">
              {selectedBusiness
                ? "Business value ($)"
                : leg.sellAmountMode === "dollar"
                  ? "Amount to sell ($)"
                  : "Sale value ($)"}
              <FieldTooltip
                text={
                  selectedBusiness
                    ? "The business on its own — goodwill and enterprise value. The accounts it owns are sold on top of this, so don't add them in here."
                    : leg.sellAmountMode === "dollar"
                      ? `Dollar amount to sell from this asset in ${year}.`
                      : `Value realized in ${year}, pre-filled from the projection. Type to override; clear to use the projection.`
                }
              />
            </label>
            <CurrencyInput
              id="overrideSaleValue"
              value={leg.sellAmountMode === "dollar" ? leg.overrideSaleValue : saleValueDisplay}
              onChange={(raw) => onChange({ overrideSaleValue: raw })}
              placeholder={leg.sellAmountMode === "dollar" ? "e.g. 50,000" : "Enter value"}
              className={inputClassName.replace("px-3", "pr-3")}
            />
          </div>
          <div>
            <label className={tooltipLabelClass} htmlFor="overrideBasis">
              Basis ($)
              <FieldTooltip
                text={
                  selectedBusiness
                    ? "Cost basis in the business itself. Each account it owns carries its own basis and is taxed separately."
                    : `Cost basis in ${year}, pre-filled from the projection. Type to override; used to compute the capital gain.`
                }
              />
            </label>
            <CurrencyInput
              id="overrideBasis"
              value={basisDisplay}
              onChange={(raw) => onChange({ overrideBasis: raw })}
              placeholder="Enter basis"
              className={inputClassName.replace("px-3", "pr-3")}
            />
          </div>
        </div>
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

      {/* IRC §121 home-sale exclusion — real estate sells only */}
      {isSellRealEstate && (
        <div className="flex items-center gap-1.5">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={leg.qualifiesForHomeSaleExclusion}
              onChange={(e) =>
                onChange({ qualifiesForHomeSaleExclusion: e.target.checked })
              }
              className="peer sr-only"
            />
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-hair-2 bg-card text-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-on peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50">
              <CheckIcon />
            </span>
            <span className="text-[13px] font-medium text-ink">
              Qualifies for home-sale gain exclusion (§121)
            </span>
          </label>
          <FieldTooltip text="Excludes up to $250k single / $500k married-joint of capital gain on this sale. Advisor confirms 2-of-5-year eligibility." />
        </div>
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
