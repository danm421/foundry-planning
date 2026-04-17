"use client";

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "real_estate"
  | "business"
  | "life_insurance";

interface AddAssetTransactionFormProps {
  clientId: string;
  accounts: { id: string; name: string; category: string; subType: string }[];
  liabilities: { id: string; name: string; linkedPropertyId: string | null; balance: string }[];
  initialData?: {
    id: string;
    name: string;
    type: "buy" | "sell";
    year: number;
    accountId: string | null;
    overrideSaleValue: string | null;
    overrideBasis: string | null;
    transactionCostPct: string | null;
    transactionCostFlat: string | null;
    proceedsAccountId: string | null;
    assetName: string | null;
    assetCategory: string | null;
    assetSubType: string | null;
    purchasePrice: string | null;
    growthRate: string | null;
    basis: string | null;
    fundingAccountId: string | null;
    mortgageAmount: string | null;
    mortgageRate: string | null;
    mortgageTermMonths: number | null;
  };
  onClose: () => void;
  onSaved: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_TYPE_BY_CATEGORY: Record<AssetCategory, string[]> = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "roth_401k", "529", "trust", "other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life"],
};

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

const SUB_TYPE_LABELS: Record<string, string> = {
  brokerage: "Brokerage",
  savings: "Savings",
  checking: "Checking",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  roth_401k: "Roth 401(k)",
  "529": "529 Plan",
  trust: "Trust",
  other: "Other",
  primary_residence: "Primary Residence",
  rental_property: "Rental Property",
  commercial_property: "Commercial Property",
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  s_corp: "S Corp",
  c_corp: "C Corp",
  llc: "LLC",
  term: "Term Life",
  whole_life: "Whole Life",
  universal_life: "Universal Life",
  variable_life: "Variable Life",
};

// ── Shared class names ────────────────────────────────────────────────────────

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const SELECT_CLASS =
  "mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const LABEL_CLASS = "block text-sm font-medium text-gray-300";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddAssetTransactionForm({
  clientId,
  accounts,
  liabilities,
  initialData,
  onClose,
  onSaved,
}: AddAssetTransactionFormProps) {
  const isEdit = !!initialData;
  const currentYear = new Date().getFullYear();

  const [txnType, setTxnType] = useState<"buy" | "sell">(initialData?.type ?? "sell");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sell-mode state
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    initialData?.accountId ?? ""
  );

  // Buy-mode state
  const [assetCategory, setAssetCategory] = useState<AssetCategory>(
    (initialData?.assetCategory as AssetCategory) ?? "real_estate"
  );
  const [assetSubType, setAssetSubType] = useState<string>(
    initialData?.assetSubType ?? SUB_TYPE_BY_CATEGORY["real_estate"][0]
  );
  const [showMortgage, setShowMortgage] = useState<boolean>(
    !!(initialData?.mortgageAmount && Number(initialData.mortgageAmount) > 0)
  );

  // Derived: find linked mortgage for sell mode
  const linkedMortgage =
    selectedAccountId
      ? liabilities.find((l) => l.linkedPropertyId === selectedAccountId)
      : null;

  // Convert stored decimals to display percentages for initial values
  const initialTransactionCostPct = initialData?.transactionCostPct
    ? String(Math.round(Number(initialData.transactionCostPct) * 10000) / 100)
    : "";
  const initialGrowthRate = initialData?.growthRate
    ? String(Math.round(Number(initialData.growthRate) * 10000) / 100)
    : "";
  const initialMortgageRate = initialData?.mortgageRate
    ? String(Math.round(Number(initialData.mortgageRate) * 10000) / 100)
    : "";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const toOptionalString = (key: string): string | null => {
      const v = data.get(key) as string;
      return v !== "" && v != null ? v : null;
    };

    const toOptionalDecimal = (key: string): string | null => {
      const v = data.get(key) as string;
      return v !== "" && v != null ? String(Number(v) / 100) : null;
    };

    let body: Record<string, unknown>;

    if (txnType === "sell") {
      body = {
        type: "sell",
        name: data.get("name") as string,
        year: Number(data.get("year")),
        accountId: selectedAccountId || null,
        overrideSaleValue: toOptionalString("overrideSaleValue"),
        overrideBasis: toOptionalString("overrideBasis"),
        transactionCostPct: toOptionalDecimal("transactionCostPct"),
        transactionCostFlat: toOptionalString("transactionCostFlat"),
        proceedsAccountId: toOptionalString("proceedsAccountId") || null,
      };
    } else {
      const mortgageAmount = toOptionalString("mortgageAmount");
      body = {
        type: "buy",
        name: data.get("name") as string,
        year: Number(data.get("year")),
        assetName: toOptionalString("assetName"),
        assetCategory: assetCategory,
        assetSubType: assetSubType,
        purchasePrice: toOptionalString("purchasePrice"),
        growthRate: toOptionalDecimal("growthRate"),
        basis: toOptionalString("basis"),
        fundingAccountId: toOptionalString("fundingAccountId") || null,
        mortgageAmount: showMortgage ? mortgageAmount : null,
        mortgageRate: showMortgage ? toOptionalDecimal("mortgageRate") : null,
        mortgageTermMonths: showMortgage
          ? (toOptionalString("mortgageTermMonths") ? Number(data.get("mortgageTermMonths")) : null)
          : null,
      };
    }

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/asset-transactions`
        : `/api/clients/${clientId}/asset-transactions`;
      const method = isEdit ? "PUT" : "POST";
      const payload = isEdit ? { ...body, transactionId: initialData!.id } : body;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save transaction");
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-6"
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">
            {isEdit ? "Edit Transaction" : "Add Asset Transaction"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        {/* Buy / Sell toggle */}
        <div className="mb-5 flex rounded-md border border-gray-700 p-1 gap-1">
          <button
            type="button"
            onClick={() => setTxnType("sell")}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
              txnType === "sell"
                ? "bg-red-900/60 text-red-300 border border-red-700/50"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Sell
          </button>
          <button
            type="button"
            onClick={() => setTxnType("buy")}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
              txnType === "buy"
                ? "bg-green-900/60 text-green-300 border border-green-700/50"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Buy
          </button>
        </div>

        <div className="space-y-4">
          {/* ── Sell fields ─────────────────────────────────────────────────── */}
          {txnType === "sell" && (
            <>
              {/* Name */}
              <div>
                <label className={LABEL_CLASS} htmlFor="sell-name">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="sell-name"
                  name="name"
                  type="text"
                  required
                  defaultValue={initialData?.name ?? ""}
                  placeholder="e.g., Sell Primary Home"
                  className={INPUT_CLASS}
                />
              </div>

              {/* Account to sell + Year */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={LABEL_CLASS} htmlFor="accountId">
                    Account to Sell
                  </label>
                  <select
                    id="accountId"
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">— Select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={LABEL_CLASS} htmlFor="sell-year">
                    Year <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="sell-year"
                    name="year"
                    type="number"
                    required
                    defaultValue={initialData?.year ?? currentYear}
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Override Sale Value */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="overrideSaleValue">
                    Override Sale Value ($)
                  </label>
                  <input
                    id="overrideSaleValue"
                    name="overrideSaleValue"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={initialData?.overrideSaleValue ?? ""}
                    placeholder="Leave blank for projected"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Override Basis */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="overrideBasis">
                    Override Basis ($)
                  </label>
                  <input
                    id="overrideBasis"
                    name="overrideBasis"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={initialData?.overrideBasis ?? ""}
                    placeholder="Leave blank for projected"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Transaction Cost % */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="transactionCostPct">
                    Transaction Cost (%)
                  </label>
                  <input
                    id="transactionCostPct"
                    name="transactionCostPct"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    defaultValue={initialTransactionCostPct}
                    placeholder="Optional"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Transaction Cost $ */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="transactionCostFlat">
                    Transaction Cost ($)
                  </label>
                  <input
                    id="transactionCostFlat"
                    name="transactionCostFlat"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={initialData?.transactionCostFlat ?? ""}
                    placeholder="Optional"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Proceeds Destination */}
                <div className="col-span-2">
                  <label className={LABEL_CLASS} htmlFor="proceedsAccountId">
                    Proceeds Destination
                  </label>
                  <select
                    id="proceedsAccountId"
                    name="proceedsAccountId"
                    defaultValue={initialData?.proceedsAccountId ?? ""}
                    className={SELECT_CLASS}
                  >
                    <option value="">Default Checking</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Linked mortgage display */}
              {linkedMortgage && (
                <div className="rounded-md border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-300">
                  <span className="font-medium">Linked Mortgage:</span>{" "}
                  {linkedMortgage.name} — Balance:{" "}
                  {formatCurrency(linkedMortgage.balance)}{" "}
                  <span className="text-amber-400/70">(will be paid off at sale)</span>
                </div>
              )}
            </>
          )}

          {/* ── Buy fields ──────────────────────────────────────────────────── */}
          {txnType === "buy" && (
            <>
              {/* Name */}
              <div>
                <label className={LABEL_CLASS} htmlFor="buy-name">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="buy-name"
                  name="name"
                  type="text"
                  required
                  defaultValue={initialData?.name ?? ""}
                  placeholder="e.g., Buy Rental Property"
                  className={INPUT_CLASS}
                />
              </div>

              {/* Year */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS} htmlFor="buy-year">
                    Year <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="buy-year"
                    name="year"
                    type="number"
                    required
                    defaultValue={initialData?.year ?? currentYear}
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Asset Name */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="assetName">
                    Asset Name
                  </label>
                  <input
                    id="assetName"
                    name="assetName"
                    type="text"
                    defaultValue={initialData?.assetName ?? ""}
                    placeholder="e.g., 123 Main St"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Asset Category */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="assetCategory">
                    Asset Category
                  </label>
                  <select
                    id="assetCategory"
                    value={assetCategory}
                    onChange={(e) => {
                      const newCat = e.target.value as AssetCategory;
                      setAssetCategory(newCat);
                      setAssetSubType(SUB_TYPE_BY_CATEGORY[newCat][0]);
                    }}
                    className={SELECT_CLASS}
                  >
                    {(Object.keys(CATEGORY_LABELS) as AssetCategory[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Asset Sub-Type */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="assetSubType">
                    Asset Sub-Type
                  </label>
                  <select
                    id="assetSubType"
                    value={assetSubType}
                    onChange={(e) => setAssetSubType(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {SUB_TYPE_BY_CATEGORY[assetCategory].map((t) => (
                      <option key={t} value={t}>
                        {SUB_TYPE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Purchase Price */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="purchasePrice">
                    Purchase Price ($)
                  </label>
                  <input
                    id="purchasePrice"
                    name="purchasePrice"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={initialData?.purchasePrice ?? ""}
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Growth Rate */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="growthRate">
                    Growth Rate (%)
                  </label>
                  <input
                    id="growthRate"
                    name="growthRate"
                    type="number"
                    step="0.01"
                    min={0}
                    max={30}
                    defaultValue={initialGrowthRate}
                    placeholder="e.g., 3.5"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Basis */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="basis">
                    Basis ($)
                  </label>
                  <input
                    id="basis"
                    name="basis"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={initialData?.basis ?? ""}
                    placeholder="Optional"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Funding Source */}
                <div>
                  <label className={LABEL_CLASS} htmlFor="fundingAccountId">
                    Funding Source
                  </label>
                  <select
                    id="fundingAccountId"
                    name="fundingAccountId"
                    defaultValue={initialData?.fundingAccountId ?? ""}
                    className={SELECT_CLASS}
                  >
                    <option value="">Withdrawal Strategy</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Collapsible Mortgage section */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowMortgage((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200"
                >
                  <span
                    className={`inline-block transition-transform text-xs ${showMortgage ? "rotate-90" : ""}`}
                  >
                    ▶
                  </span>
                  Mortgage / Financing
                </button>

                {showMortgage && (
                  <div className="mt-3 grid grid-cols-3 gap-4 rounded-md border border-gray-700 bg-gray-800/50 p-4">
                    <div>
                      <label className={LABEL_CLASS} htmlFor="mortgageAmount">
                        Mortgage Amount ($)
                      </label>
                      <input
                        id="mortgageAmount"
                        name="mortgageAmount"
                        type="number"
                        step="0.01"
                        min={0}
                        defaultValue={initialData?.mortgageAmount ?? ""}
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div>
                      <label className={LABEL_CLASS} htmlFor="mortgageRate">
                        Interest Rate (%)
                      </label>
                      <input
                        id="mortgageRate"
                        name="mortgageRate"
                        type="number"
                        step="0.01"
                        min={0}
                        max={30}
                        defaultValue={initialMortgageRate}
                        placeholder="e.g., 6.75"
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div>
                      <label className={LABEL_CLASS} htmlFor="mortgageTermMonths">
                        Term (months)
                      </label>
                      <input
                        id="mortgageTermMonths"
                        name="mortgageTermMonths"
                        type="number"
                        step="1"
                        min={1}
                        defaultValue={initialData?.mortgageTermMonths ?? 360}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 hover:border-gray-500 hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Saving…" : isEdit ? "Save Changes" : txnType === "buy" ? "Add Buy" : "Add Sell"}
          </button>
        </div>
      </form>
    </div>
  );
}
