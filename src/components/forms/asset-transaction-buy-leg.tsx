"use client";

import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import {
  SUB_TYPE_BY_CATEGORY,
  CATEGORY_LABELS,
  SUB_TYPE_LABELS,
  FUNDING_SPECIAL_OPTIONS,
} from "./asset-transaction-leg-model";
import type { BuyLegDraft, AssetCategory } from "./asset-transaction-leg-model";

// ── Inline icons ──────────────────────────────────────────────────────────────

/** Chevron that rotates 90° when its section is expanded. */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BuyLegEditorProps {
  leg: BuyLegDraft;
  onChange: (patch: Partial<BuyLegDraft>) => void;
  accounts: { id: string; name: string; category: string; subType: string }[];
  /**
   * Prefixed onto every field id/htmlFor pair. This component was written for
   * a single-instance dialog and hardcodes ids like `id="assetName"` —
   * rendering more than one instance on a page (e.g. one per planned
   * purchase in the Goals import step) duplicates those ids, which breaks
   * `getByLabelText` and any other id-based lookup. Defaults to "" so
   * existing single-instance callers are unaffected.
   */
  idPrefix?: string;
  /**
   * Restricts the Asset Category select to this list. Defaults to every
   * category (all of `CATEGORY_LABELS`), so `add-asset-transaction-form.tsx`'s
   * general-purpose dialog is completely unaffected. Pass a single-entry list
   * (e.g. `["real_estate"]`) to lock a mounted instance to one category — the
   * Goals import step does this because a planned purchase there is always a
   * home and `HomePurchaseGoal` has no `assetCategory` field to hold anything
   * else; without this restriction the select lets an advisor pick any
   * category, and `toBuyLeg`'s hardcoded `assetCategory: "real_estate"` on
   * the NEXT render papers over the select while leaving `assetSubType` set
   * to a value from the wrong category's list.
   */
  categories?: AssetCategory[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BuyLegEditor({ leg, onChange, accounts, idPrefix = "", categories }: BuyLegEditorProps) {
  const fieldId = (name: string) => `${idPrefix}${name}`;
  const categoryOptions = categories ?? (Object.keys(CATEGORY_LABELS) as AssetCategory[]);
  return (
    <div className="space-y-4">
      {/* Asset Name */}
      <div>
        <label className={fieldLabelClassName} htmlFor={fieldId("assetName")}>
          Asset Name
        </label>
        <input
          id={fieldId("assetName")}
          type="text"
          value={leg.assetName}
          onChange={(e) => onChange({ assetName: e.target.value })}
          placeholder="e.g., 123 Main St"
          className={inputClassName}
        />
      </div>

      {/* Category + Sub-Type */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor={fieldId("assetCategory")}>
            Asset Category
          </label>
          <select
            id={fieldId("assetCategory")}
            value={leg.assetCategory}
            onChange={(e) => {
              const cat = e.target.value as AssetCategory;
              const firstSubType = SUB_TYPE_BY_CATEGORY[cat]?.[0];
              // A native <select> resets its value to "" (no matching option)
              // rather than accepting an unrecognized one — reachable when
              // `categories` restricts the rendered options and something
              // still fires a change event with a value outside that list.
              // Nothing to apply in that case; the select's own next render
              // still reflects `leg.assetCategory` correctly.
              if (firstSubType === undefined) return;
              onChange({ assetCategory: cat, assetSubType: firstSubType });
            }}
            className={selectClassName}
          >
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor={fieldId("assetSubType")}>
            Sub-Type
          </label>
          <select
            id={fieldId("assetSubType")}
            value={leg.assetSubType}
            onChange={(e) => onChange({ assetSubType: e.target.value })}
            className={selectClassName}
          >
            {SUB_TYPE_BY_CATEGORY[leg.assetCategory].map((t) => (
              <option key={t} value={t}>
                {SUB_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Purchase Price + Growth Rate */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor={fieldId("purchasePrice")}>
            Purchase Price ($)
          </label>
          <CurrencyInput
            id={fieldId("purchasePrice")}
            value={leg.purchasePrice}
            onChange={(raw) => onChange({ purchasePrice: raw })}
            className={inputClassName.replace("px-3", "pr-3")}
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor={fieldId("growthRate")}>
            Growth Rate (%)
          </label>
          <PercentInput
            id={fieldId("growthRate")}
            value={leg.growthRate}
            onChange={(raw) => onChange({ growthRate: raw })}
            placeholder="e.g., 3.5"
            className={inputClassName}
          />
        </div>
      </div>

      {/* Basis + Funding Source */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor={fieldId("basis")}>
            Basis ($)
          </label>
          <CurrencyInput
            id={fieldId("basis")}
            value={leg.basis}
            onChange={(raw) => onChange({ basis: raw })}
            placeholder="Optional"
            className={inputClassName.replace("px-3", "pr-3")}
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor={fieldId("fundingAccountId")}>
            Funding Source
          </label>
          <select
            id={fieldId("fundingAccountId")}
            value={leg.fundingAccountId}
            onChange={(e) => onChange({ fundingAccountId: e.target.value })}
            className={selectClassName}
          >
            {FUNDING_SPECIAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Collapsible Mortgage section */}
      <div>
        <button
          type="button"
          onClick={() => onChange({ showMortgage: !leg.showMortgage })}
          aria-expanded={leg.showMortgage}
          className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
            leg.showMortgage ? "text-good" : "text-ink-2 hover:text-ink"
          }`}
        >
          <ChevronIcon expanded={leg.showMortgage} />
          Mortgage / Financing
        </button>

        {leg.showMortgage && (
          <div className="mt-3 grid grid-cols-3 gap-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-4">
            <div>
              <label className={fieldLabelClassName} htmlFor={fieldId("mortgageAmount")}>
                Amount ($)
              </label>
              <CurrencyInput
                id={fieldId("mortgageAmount")}
                value={leg.mortgageAmount}
                onChange={(raw) => onChange({ mortgageAmount: raw })}
                className={inputClassName.replace("px-3", "pr-3")}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor={fieldId("mortgageRate")}>
                Rate (%)
              </label>
              <PercentInput
                id={fieldId("mortgageRate")}
                value={leg.mortgageRate}
                onChange={(raw) => onChange({ mortgageRate: raw })}
                placeholder="e.g., 6.75"
                className={inputClassName}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor={fieldId("mortgageTermMonths")}>
                Term (mo)
              </label>
              <input
                id={fieldId("mortgageTermMonths")}
                type="number"
                step="1"
                min={1}
                value={leg.mortgageTermMonths}
                onChange={(e) => onChange({ mortgageTermMonths: e.target.value })}
                className={inputClassName}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
