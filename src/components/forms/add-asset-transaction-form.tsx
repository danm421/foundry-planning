"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";

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
  pastBuys?: {
    id: string;
    name: string;
    assetName: string | null;
    year: number;
    assetCategory: string | null;
  }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialData?: {
    id: string;
    name: string;
    type: "buy" | "sell";
    year: number;
    accountId: string | null;
    purchaseTransactionId: string | null;
    fractionSold: string | null;
    overrideSaleValue: string | null;
    overrideBasis: string | null;
    transactionCostPct: string | null;
    transactionCostFlat: string | null;
    proceedsAccountId: string | null;
    qualifiesForHomeSaleExclusion: boolean | null;
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
  retirement: ["traditional_ira", "roth_ira", "401k", "403b", "529", "trust", "other"],
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
  "403b": "403(b)",
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

const FUNDING_SPECIAL_OPTIONS = [
  { value: "", label: "Withdrawal Strategy" },
  { value: "__from_sale_proceeds__", label: "From Sale Proceeds" },
];

// ── Shared class names ────────────────────────────────────────────────────────

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const SELECT_CLASS =
  "mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

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

function parseNum(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── Collapsible Section ──────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  accentColor,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  accentColor: "red" | "green";
  children: React.ReactNode;
}) {
  const borderColor = accentColor === "red" ? "border-red-800/40" : "border-green-800/40";
  const bgColor = accentColor === "red" ? "bg-red-950/20" : "bg-green-950/20";
  const textColor = accentColor === "red" ? "text-red-300" : "text-green-300";

  return (
    <div className={`rounded-md border ${borderColor} ${bgColor}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium ${textColor} hover:brightness-125`}
      >
        <span
          className={`inline-block text-xs transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        {title}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddAssetTransactionForm({
  clientId,
  accounts,
  liabilities,
  pastBuys: pastBuysProp,
  milestones,
  clientFirstName,
  spouseFirstName,
  initialData,
  onClose,
  onSaved,
}: AddAssetTransactionFormProps) {
  const writer = useScenarioWriter(clientId);
  const isEdit = !!initialData;
  const currentYear = new Date().getFullYear();
  const pastBuys = pastBuysProp ?? [];

  // Determine initial section state from initialData
  const initialHasSell = !initialData || initialData.type === "sell";
  const initialHasBuy = !!initialData && initialData.type === "buy";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Common fields ─────────────────────────────────────────────────────────
  const [name, setName] = useState(initialData?.name ?? "");
  const [year, setYear] = useState(initialData?.year ?? currentYear);
  const [yearRef, setYearRef] = useState<YearRef | null>(null);

  // ── Section visibility ────────────────────────────────────────────────────
  const [sellExpanded, setSellExpanded] = useState(initialHasSell);
  const [buyExpanded, setBuyExpanded] = useState(initialHasBuy);

  // ── Sell-side state ───────────────────────────────────────────────────────
  const [sellAccountId, setSellAccountId] = useState<string>(
    initialData?.accountId ?? "",
  );
  const [sellPurchaseTransactionId, setSellPurchaseTransactionId] = useState<string>(
    initialData?.purchaseTransactionId ?? "",
  );
  const [overrideSaleValue, setOverrideSaleValue] = useState(
    initialData?.overrideSaleValue ?? "",
  );
  const [overrideBasis, setOverrideBasis] = useState(
    initialData?.overrideBasis ?? "",
  );
  const [transactionCostPct, setTransactionCostPct] = useState(
    initialData?.transactionCostPct
      ? String(Math.round(Number(initialData.transactionCostPct) * 10000) / 100)
      : "",
  );
  const [transactionCostFlat, setTransactionCostFlat] = useState(
    initialData?.transactionCostFlat ?? "",
  );
  const [proceedsAccountId, setProceedsAccountId] = useState(
    initialData?.proceedsAccountId ?? "",
  );
  const [qualifiesForHomeSaleExclusion, setQualifiesForHomeSaleExclusion] = useState<boolean>(
    initialData?.qualifiesForHomeSaleExclusion ?? false,
  );

  // ── Buy-side state ────────────────────────────────────────────────────────
  const [assetName, setAssetName] = useState(initialData?.assetName ?? "");
  const [assetCategory, setAssetCategory] = useState<AssetCategory>(
    (initialData?.assetCategory as AssetCategory) ?? "real_estate",
  );
  const [assetSubType, setAssetSubType] = useState<string>(
    initialData?.assetSubType ?? SUB_TYPE_BY_CATEGORY["real_estate"][0],
  );
  const [purchasePrice, setPurchasePrice] = useState(initialData?.purchasePrice ?? "");
  const [buyGrowthRate, setBuyGrowthRate] = useState(
    initialData?.growthRate
      ? String(Math.round(Number(initialData.growthRate) * 10000) / 100)
      : "",
  );
  const [buyBasis, setBuyBasis] = useState(initialData?.basis ?? "");
  const [fundingAccountId, setFundingAccountId] = useState(
    initialData?.fundingAccountId ?? "",
  );
  const [showMortgage, setShowMortgage] = useState(
    !!(initialData?.mortgageAmount && Number(initialData.mortgageAmount) > 0),
  );
  const [mortgageAmount, setMortgageAmount] = useState(initialData?.mortgageAmount ?? "");
  const [mortgageRate, setMortgageRate] = useState(
    initialData?.mortgageRate
      ? String(Math.round(Number(initialData.mortgageRate) * 10000) / 100)
      : "",
  );
  const [mortgageTermMonths, setMortgageTermMonths] = useState(
    String(initialData?.mortgageTermMonths ?? 360),
  );

  // ── Projection data for projected values ──────────────────────────────────
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProjection() {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) return;
        const data: ClientData = await res.json();
        const projection = runProjection(data);
        if (!cancelled) setProjectionYears(projection);
      } catch {
        // Silently fail — projected hints are optional
      }
    }
    loadProjection();
    return () => { cancelled = true; };
  }, [clientId]);

  // Look up projected value and basis for the sell account in the selected year.
  // Sales run BoY in the engine, so the BoY snapshots (beginningValue on the
  // account ledger, accountBasisBoY on the projection year) are exactly what
  // the engine will use to price the sale.
  const projectedSellInfo = useMemo(() => {
    if (!projectionYears || !sellAccountId || !year) return null;
    const projYear = projectionYears.find((py) => py.year === year);
    if (!projYear) return null;
    const ledger = projYear.accountLedgers[sellAccountId];
    if (!ledger) return null;
    const projectedBasis = projYear.accountBasisBoY?.[sellAccountId] ?? null;
    return {
      projectedValue: ledger.beginningValue,
      projectedBasis,
    };
  }, [projectionYears, sellAccountId, year]);

  // Linked mortgage for sell side
  const linkedMortgage = sellAccountId
    ? liabilities.find((l) => l.linkedPropertyId === sellAccountId)
    : null;

  // Projected mortgage balance from the projection at BoY of the sale year —
  // this is the amount the engine will actually pay off when the sale executes.
  const projectedMortgageBalance = useMemo(() => {
    if (!projectionYears || !linkedMortgage || !year) return null;
    const projYear = projectionYears.find((py) => py.year === year);
    if (!projYear) return null;
    const bal = projYear.liabilityBalancesBoY?.[linkedMortgage.id];
    return bal != null ? bal : null;
  }, [projectionYears, linkedMortgage, year]);

  // ── Net Summary calculations ──────────────────────────────────────────────
  const sellHasData = !!(sellAccountId || sellPurchaseTransactionId);
  const buyHasData = !!(assetName || parseNum(purchasePrice as string) > 0);

  const netSummary = useMemo(() => {
    const saleValue = parseNum(overrideSaleValue as string) ||
      (projectedSellInfo?.projectedValue ?? 0);
    const costPct = parseNum(transactionCostPct) / 100;
    const costFlat = parseNum(transactionCostFlat as string);
    const totalTransactionCosts = saleValue * costPct + costFlat;
    // Prefer the projected BoY balance for the sale year; fall back to the
    // static liability balance only if projection data hasn't loaded yet.
    const mortgagePayoff = linkedMortgage
      ? (projectedMortgageBalance ?? parseNum(linkedMortgage.balance))
      : 0;
    const saleProceeds = sellHasData ? saleValue - totalTransactionCosts - mortgagePayoff : 0;

    const price = parseNum(purchasePrice as string);
    const mortgage = showMortgage ? parseNum(mortgageAmount as string) : 0;
    const purchaseCost = buyHasData ? price - mortgage : 0;

    const net = saleProceeds - purchaseCost;

    return {
      saleValue: sellHasData ? saleValue : 0,
      transactionCosts: totalTransactionCosts,
      mortgagePayoff,
      saleProceeds,
      purchasePrice: price,
      purchaseMortgage: mortgage,
      purchaseCost,
      net,
      hasSell: sellHasData,
      hasBuy: buyHasData,
    };
  }, [
    overrideSaleValue, projectedSellInfo, transactionCostPct, transactionCostFlat,
    linkedMortgage, projectedMortgageBalance, sellHasData, purchasePrice,
    showMortgage, mortgageAmount, buyHasData,
  ]);

  // ── Derive transaction type from filled sides ─────────────────────────────
  const deriveType = useCallback((): "buy" | "sell" => {
    if (sellHasData && !buyHasData) return "sell";
    if (!sellHasData && buyHasData) return "buy";
    // Both filled → "sell" (primary action)
    return "sell";
  }, [sellHasData, buyHasData]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const toOptionalString = (v: string | null | undefined): string | null => {
      return v !== "" && v != null ? v : null;
    };

    const toOptionalDecimal = (v: string | null | undefined): string | null => {
      return v !== "" && v != null ? String(Number(v) / 100) : null;
    };

    const txType = deriveType();

    // Build body with all fields — the API will use what it needs based on type
    const body: Record<string, unknown> = {
      type: txType,
      name,
      year,
    };

    // Sell-side fields (always include if sell side has data)
    if (sellHasData) {
      body.accountId = sellAccountId || null;
      body.purchaseTransactionId = sellPurchaseTransactionId || null;
      body.overrideSaleValue = toOptionalString(overrideSaleValue as string);
      body.overrideBasis = toOptionalString(overrideBasis as string);
      body.transactionCostPct = toOptionalDecimal(transactionCostPct);
      body.transactionCostFlat = toOptionalString(transactionCostFlat as string);
      body.proceedsAccountId = toOptionalString(proceedsAccountId) || null;
      // Belt-and-suspenders: never persist true for a non-real-estate sale.
      body.qualifiesForHomeSaleExclusion = isSellRealEstate && qualifiesForHomeSaleExclusion;
    }

    // Buy-side fields (always include if buy side has data)
    if (buyHasData) {
      body.assetName = toOptionalString(assetName);
      body.assetCategory = assetCategory;
      body.assetSubType = assetSubType;
      body.purchasePrice = toOptionalString(purchasePrice as string);
      body.growthRate = toOptionalDecimal(buyGrowthRate);
      body.basis = toOptionalString(buyBasis as string);
      const funding = fundingAccountId === "__from_sale_proceeds__" ? null : (toOptionalString(fundingAccountId) || null);
      body.fundingAccountId = funding;
      body.mortgageAmount = showMortgage ? toOptionalString(mortgageAmount as string) : null;
      body.mortgageRate = showMortgage ? toOptionalDecimal(mortgageRate) : null;
      body.mortgageTermMonths = showMortgage && mortgageTermMonths
        ? Number(mortgageTermMonths)
        : null;
    }

    try {
      const newTransactionId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = isEdit
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "asset_transaction",
              targetId: initialData!.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/asset-transactions`,
              method: "PUT",
              body: { ...body, transactionId: initialData!.id },
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "asset_transaction",
              entity: { id: newTransactionId, ...body },
            },
            {
              url: `/api/clients/${clientId}/asset-transactions`,
              method: "POST",
              body,
            },
          );

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

  // ── Selected sell account info ────────────────────────────────────────────
  const sellAccount = accounts.find((a) => a.id === sellAccountId);
  const isSellRealEstate = sellAccount?.category === "real_estate";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-6 shadow-xl"
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">
            {isEdit ? "Edit Transaction" : "Add Asset Transaction"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        {/* ── Common fields ──────────────────────────────────────────────── */}
        <div className="mb-5 space-y-4">
          <div>
            <label className={LABEL_CLASS} htmlFor="txn-name">
              Transaction Name <span className="text-red-500">*</span>
            </label>
            <input
              id="txn-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sell Home A, Buy Rental Property"
              className={INPUT_CLASS}
            />
          </div>

          <div className="w-1/2">
            {milestones ? (
              <MilestoneYearPicker
                name="txn-year"
                id="txn-year"
                value={year}
                yearRef={yearRef}
                milestones={milestones}
                onChange={(y, r) => { setYear(y); setYearRef(r); }}
                label="Year *"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName}
              />
            ) : (
              <>
                <label className={LABEL_CLASS} htmlFor="txn-year">
                  Year <span className="text-red-500">*</span>
                </label>
                <input
                  id="txn-year"
                  type="number"
                  required
                  value={year}
                  onChange={(e) => { setYear(Number(e.target.value)); setYearRef(null); }}
                  className={INPUT_CLASS}
                />
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* ── Sell + Buy Side (side by side) ──────────────────────────── */}
          <div className="grid grid-cols-2 gap-6">
          {/* ── Sell Side ───────────────────────────────────────────────── */}
          <CollapsibleSection
            title="Sell Side"
            expanded={sellExpanded}
            onToggle={() => setSellExpanded((v) => !v)}
            accentColor="red"
          >
            <div className="space-y-4">
              {/* Account to sell */}
              <div>
                <label className={LABEL_CLASS} htmlFor="sellAccountId">
                  Account to Sell
                </label>
                <select
                  id="sellAccountId"
                  value={
                    sellAccountId ||
                    (sellPurchaseTransactionId
                      ? `buy:${sellPurchaseTransactionId}`
                      : "")
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith("buy:")) {
                      setSellPurchaseTransactionId(v.slice(4));
                      setSellAccountId("");
                    } else {
                      setSellAccountId(v);
                      setSellPurchaseTransactionId("");
                    }
                  }}
                  className={SELECT_CLASS}
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

              {/* Override Sale Value + Basis */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS} htmlFor="overrideSaleValue">
                    Override Sale Value ($)
                  </label>
                  <CurrencyInput
                    id="overrideSaleValue"
                    value={overrideSaleValue}
                    onChange={(raw) => setOverrideSaleValue(raw)}
                    placeholder="Leave blank for projected"
                    className={INPUT_CLASS.replace("px-3", "pr-3")}
                  />
                  {projectedSellInfo && projectedSellInfo.projectedValue > 0 && (
                    <p className="mt-1 text-xs text-gray-400">
                      Projected value in {year}:{" "}
                      <span className="text-gray-300">
                        {formatCurrency(projectedSellInfo.projectedValue)}
                      </span>
                    </p>
                  )}
                </div>

                <div>
                  <label className={LABEL_CLASS} htmlFor="overrideBasis">
                    Override Basis ($)
                  </label>
                  <CurrencyInput
                    id="overrideBasis"
                    value={overrideBasis}
                    onChange={(raw) => setOverrideBasis(raw)}
                    placeholder="Leave blank for projected"
                    className={INPUT_CLASS.replace("px-3", "pr-3")}
                  />
                  {projectedSellInfo && projectedSellInfo.projectedBasis != null && (
                    <p className="mt-1 text-xs text-gray-400">
                      Projected basis in {year}:{" "}
                      <span className="text-gray-300">
                        {formatCurrency(projectedSellInfo.projectedBasis)}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Transaction Costs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS} htmlFor="transactionCostPct">
                    Transaction Cost (%)
                  </label>
                  <PercentInput
                    id="transactionCostPct"
                    value={transactionCostPct}
                    onChange={(raw) => setTransactionCostPct(raw)}
                    placeholder="Optional"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor="transactionCostFlat">
                    Transaction Cost ($)
                  </label>
                  <CurrencyInput
                    id="transactionCostFlat"
                    value={transactionCostFlat}
                    onChange={(raw) => setTransactionCostFlat(raw)}
                    placeholder="Optional"
                    className={INPUT_CLASS.replace("px-3", "pr-3")}
                  />
                </div>
              </div>

              {/* Linked mortgage display for real estate */}
              {isSellRealEstate && linkedMortgage && (
                <div className="rounded-md border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-300">
                  <div>
                    <span className="font-medium">Linked Mortgage:</span>{" "}
                    {linkedMortgage.name}
                  </div>
                  <div className="mt-0.5">
                    Projected balance in {year}:{" "}
                    {formatCurrency(
                      projectedMortgageBalance ?? parseNum(linkedMortgage.balance)
                    )}
                  </div>
                  <div className="mt-0.5 text-amber-400/70">
                    Will be paid off at sale
                  </div>
                </div>
              )}

              {/* IRC §121 home-sale exclusion — real estate sells only */}
              {isSellRealEstate && (
                <label className="flex items-start gap-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={qualifiesForHomeSaleExclusion}
                    onChange={(e) => setQualifiesForHomeSaleExclusion(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-1 focus:ring-accent"
                  />
                  <span>
                    <span className="font-medium text-gray-200">
                      Qualifies for home-sale gain exclusion (§121)
                    </span>
                    <span className="block text-xs text-gray-400">
                      Excludes up to $250k single / $500k married-joint of capital gain on this sale. Advisor confirms 2-of-5-year eligibility.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </CollapsibleSection>

          {/* ── Buy Side ────────────────────────────────────────────────── */}
          <CollapsibleSection
            title="Buy Side"
            expanded={buyExpanded}
            onToggle={() => setBuyExpanded((v) => !v)}
            accentColor="green"
          >
            <div className="space-y-4">
              {/* Asset Name */}
              <div>
                <label className={LABEL_CLASS} htmlFor="assetName">
                  Asset Name
                </label>
                <input
                  id="assetName"
                  type="text"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="e.g., 123 Main St"
                  className={INPUT_CLASS}
                />
              </div>

              {/* Category + Sub-Type */}
              <div className="grid grid-cols-2 gap-4">
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
                <div>
                  <label className={LABEL_CLASS} htmlFor="assetSubType">
                    Sub-Type
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
              </div>

              {/* Purchase Price + Growth Rate */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS} htmlFor="purchasePrice">
                    Purchase Price ($)
                  </label>
                  <CurrencyInput
                    id="purchasePrice"
                    value={purchasePrice}
                    onChange={(raw) => setPurchasePrice(raw)}
                    className={INPUT_CLASS.replace("px-3", "pr-3")}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor="buyGrowthRate">
                    Growth Rate (%)
                  </label>
                  <PercentInput
                    id="buyGrowthRate"
                    value={buyGrowthRate}
                    onChange={(raw) => setBuyGrowthRate(raw)}
                    placeholder="e.g., 3.5"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              {/* Basis + Funding Source */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS} htmlFor="buyBasis">
                    Basis ($)
                  </label>
                  <CurrencyInput
                    id="buyBasis"
                    value={buyBasis}
                    onChange={(raw) => setBuyBasis(raw)}
                    placeholder="Optional"
                    className={INPUT_CLASS.replace("px-3", "pr-3")}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor="fundingAccountId">
                    Funding Source
                  </label>
                  <select
                    id="fundingAccountId"
                    value={fundingAccountId}
                    onChange={(e) => setFundingAccountId(e.target.value)}
                    className={SELECT_CLASS}
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
                  onClick={() => setShowMortgage((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-gray-200"
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
                        Amount ($)
                      </label>
                      <CurrencyInput
                        id="mortgageAmount"
                        value={mortgageAmount}
                        onChange={(raw) => setMortgageAmount(raw)}
                        className={INPUT_CLASS.replace("px-3", "pr-3")}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS} htmlFor="mortgageRate">
                        Rate (%)
                      </label>
                      <PercentInput
                        id="mortgageRate"
                        value={mortgageRate}
                        onChange={(raw) => setMortgageRate(raw)}
                        placeholder="e.g., 6.75"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS} htmlFor="mortgageTermMonths">
                        Term (mo)
                      </label>
                      <input
                        id="mortgageTermMonths"
                        type="number"
                        step="1"
                        min={1}
                        value={mortgageTermMonths}
                        onChange={(e) => setMortgageTermMonths(e.target.value)}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>
          </div>{/* end grid grid-cols-2 */}

          {/* ── Net Summary ─────────────────────────────────────────────── */}
          {(netSummary.hasSell || netSummary.hasBuy) && (
            <div className="rounded-md border border-gray-700 bg-gray-800/50 px-4 py-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-300">
                Net Summary
              </h4>
              <div className="space-y-1 text-sm">
                {netSummary.hasSell && (
                  <>
                    <div className="flex justify-between text-gray-300">
                      <span>Sale Value</span>
                      <span>{formatCurrency(netSummary.saleValue)}</span>
                    </div>
                    {netSummary.transactionCosts > 0 && (
                      <div className="flex justify-between text-gray-300">
                        <span className="pl-3">- Transaction Costs</span>
                        <span>{formatCurrency(netSummary.transactionCosts)}</span>
                      </div>
                    )}
                    {netSummary.mortgagePayoff > 0 && (
                      <div className="flex justify-between text-gray-300">
                        <span className="pl-3">- Mortgage Payoff</span>
                        <span>{formatCurrency(netSummary.mortgagePayoff)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium text-gray-200">
                      <span>Sale Proceeds</span>
                      <span>{formatCurrency(netSummary.saleProceeds)}</span>
                    </div>
                  </>
                )}
                {netSummary.hasBuy && (
                  <>
                    {netSummary.hasSell && (
                      <div className="my-1 border-t border-gray-700" />
                    )}
                    <div className="flex justify-between text-gray-300">
                      <span>Purchase Price</span>
                      <span>{formatCurrency(netSummary.purchasePrice)}</span>
                    </div>
                    {netSummary.purchaseMortgage > 0 && (
                      <div className="flex justify-between text-gray-300">
                        <span className="pl-3">- Mortgage</span>
                        <span>{formatCurrency(netSummary.purchaseMortgage)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium text-gray-200">
                      <span>Cash Needed</span>
                      <span>{formatCurrency(netSummary.purchaseCost)}</span>
                    </div>
                  </>
                )}
                {netSummary.hasSell && netSummary.hasBuy && (
                  <>
                    <div className="my-1 border-t border-gray-700" />
                    <div
                      className={`flex justify-between font-semibold ${
                        netSummary.net >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      <span>Net</span>
                      <span>
                        {netSummary.net >= 0 ? "+" : ""}
                        {formatCurrency(netSummary.net)}
                      </span>
                    </div>
                    {netSummary.net < 0 && fundingAccountId && (
                      <p className="mt-1 text-xs text-gray-400">
                        Deficit will be funded from{" "}
                        {fundingAccountId === "__from_sale_proceeds__"
                          ? "sale proceeds"
                          : accounts.find((a) => a.id === fundingAccountId)?.name ?? "withdrawal strategy"}
                      </p>
                    )}
                    {netSummary.net > 0 && (
                      <p className="mt-1 text-xs text-gray-400">
                        Surplus will go to{" "}
                        {proceedsAccountId
                          ? accounts.find((a) => a.id === proceedsAccountId)?.name ?? "selected account"
                          : "default checking"}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Proceeds Destination (when surplus or sell-only) ────────── */}
          {sellHasData && (netSummary.net > 0 || !buyHasData) && (
            <div>
              <label className={LABEL_CLASS} htmlFor="proceedsAccountId">
                Proceeds Destination
              </label>
              <select
                id="proceedsAccountId"
                value={proceedsAccountId}
                onChange={(e) => setProceedsAccountId(e.target.value)}
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
            disabled={loading || (!sellHasData && !buyHasData)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
          >
            {loading ? "Saving..." : isEdit ? "Save Changes" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
