"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear, AssetTransaction } from "@/engine/types";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { coerceAssetTransactionDraft } from "@/lib/solver/technique-form-data";

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "real_estate"
  | "business"
  | "life_insurance";

export interface AssetTransactionInitialData {
  id: string;
  name: string;
  type: "buy" | "sell";
  year: number;
  accountId: string | null;
  purchaseTransactionId: string | null;
  businessAccountId: string | null;
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
}

export interface BusinessSaleOption {
  id: string;
  name: string;
  /** Display label for the business type (e.g. "LLC", "S-Corp"). */
  businessTypeLabel: string;
  value: number;
  basis: number;
  owners: Array<{
    familyMemberId: string;
    familyMemberName: string;
    percent: number;
  }>;
  /** Child accounts (accounts.parentAccountId === business.id). */
  childAccounts: Array<{
    id: string;
    name: string;
    currentValue: number;
  }>;
  /** Child liabilities (liabilities.parentAccountId === business.id). */
  childLiabilities: Array<{
    id: string;
    name: string;
    currentBalance: number;
  }>;
}

interface AddAssetTransactionFormProps {
  clientId: string;
  accounts: { id: string; name: string; category: string; subType: string }[];
  liabilities: { id: string; name: string; linkedPropertyId: string | null; balance: string }[];
  /** Available business accounts the user can sell from. */
  businesses?: BusinessSaleOption[];
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
  initialData?: AssetTransactionInitialData;
  /** When provided, the form emits the assembled AssetTransaction engine object
   *  via this callback and does NOT persist. The normal persist path is used
   *  when this prop is absent. */
  onSubmitDraft?: (technique: AssetTransaction) => void;
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

/** 12×12 check glyph for selectable cards. */
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
  const surfaceClass =
    accentColor === "red"
      ? "border-crit/30 bg-crit/5"
      : "border-good/30 bg-good/5";
  const headerTextClass = accentColor === "red" ? "text-crit" : "text-good";

  return (
    <div className={`rounded-[var(--radius-sm)] border ${surfaceClass}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2 px-4 py-2.5 text-[13px] font-semibold ${headerTextClass}`}
      >
        <ChevronIcon expanded={expanded} />
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
  businesses,
  pastBuys: pastBuysProp,
  milestones,
  clientFirstName,
  spouseFirstName,
  initialData,
  onSubmitDraft,
  onClose,
  onSaved,
}: AddAssetTransactionFormProps) {
  const businessOptions = businesses ?? [];
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
  // Two sell modes: an account/buy-transaction source (the original) and a
  // business-account source (cascades to children via parentAccountId).
  type SellMode = "account" | "business";
  const [sellMode, setSellMode] = useState<SellMode>(
    initialData?.businessAccountId ? "business" : "account",
  );
  const [sellAccountId, setSellAccountId] = useState<string>(
    initialData?.accountId ?? "",
  );
  const [sellPurchaseTransactionId, setSellPurchaseTransactionId] = useState<string>(
    initialData?.purchaseTransactionId ?? "",
  );
  const [sellBusinessAccountId, setSellBusinessAccountId] = useState<string>(
    initialData?.businessAccountId ?? "",
  );
  // Sell amount mode — drives whether we submit fractionSold or overrideSaleValue.
  type SellAmountMode = "full" | "percent" | "dollar";
  const initialSellMode: SellAmountMode =
    initialData?.fractionSold != null && initialData.fractionSold !== "1"
      ? "percent"
      : initialData?.overrideSaleValue
      ? "dollar"
      : "full";
  const [sellAmountMode, setSellAmountMode] = useState<SellAmountMode>(initialSellMode);
  const [fractionSoldPct, setFractionSoldPct] = useState<string>(
    initialData?.fractionSold != null
      ? String(Math.round(Number(initialData.fractionSold) * 10000) / 100)
      : "100",
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
  const sellHasData =
    sellMode === "business"
      ? !!sellBusinessAccountId
      : !!(sellAccountId || sellPurchaseTransactionId);
  const buyHasData = !!(assetName || parseNum(purchasePrice as string) > 0);
  const selectedBusiness = businessOptions.find((b) => b.id === sellBusinessAccountId);

  // ── Resell/orphan/mortgage derivations ────────────────────────────────────
  // The synthetic id used by the engine when a sell points at a prior buy is
  // `technique-acct-${buy.id}`. liabilities can be linked to those ids by
  // funding a buy with a mortgage.
  const selectedAccountId =
    sellAccountId ||
    (sellPurchaseTransactionId ? `technique-acct-${sellPurchaseTransactionId}` : "");
  const selectedHasMortgage =
    !!selectedAccountId &&
    liabilities.some((l) => l.linkedPropertyId === selectedAccountId);

  // Editing an existing sell whose source link was nulled by FK cascade
  // (the referenced buy was deleted). User must re-source before saving.
  const isOrphan =
    !!initialData &&
    initialData.type === "sell" &&
    !initialData.accountId &&
    !initialData.purchaseTransactionId;

  // Year-floor: when a buy is selected, the sell year must be > buy.year.
  const linkedBuy = pastBuys.find((b) => b.id === sellPurchaseTransactionId);
  const minSellYear = linkedBuy ? linkedBuy.year + 1 : undefined;
  const yearBeforeBuy = !!linkedBuy && year <= linkedBuy.year;

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
      if (sellMode === "business") {
        // Business sale: clear account/purchase sources, send businessAccountId.
        // Proceeds always land in household default checking on the engine side,
        // so proceedsAccountId is irrelevant; §121 home-sale exclusion never
        // applies to business-cascaded sales.
        body.accountId = null;
        body.purchaseTransactionId = null;
        body.businessAccountId = sellBusinessAccountId;
        // fractionSold drives both the operating sale and the cascade percentage.
        body.fractionSold =
          sellAmountMode === "percent"
            ? Number(fractionSoldPct) / 100
            : null;
        body.overrideSaleValue = toOptionalString(overrideSaleValue as string);
        body.overrideBasis = toOptionalString(overrideBasis as string);
        body.transactionCostPct = toOptionalDecimal(transactionCostPct);
        body.transactionCostFlat = toOptionalString(transactionCostFlat as string);
        body.proceedsAccountId = null;
        body.qualifiesForHomeSaleExclusion = false;
      } else {
        body.accountId = sellAccountId || null;
        body.purchaseTransactionId = sellPurchaseTransactionId || null;
        body.businessAccountId = null;
        // Sell-amount mode dictates exactly one of fractionSold / overrideSaleValue.
        if (sellAmountMode === "full") {
          body.fractionSold = null;
          body.overrideSaleValue = null;
        } else if (sellAmountMode === "percent") {
          body.fractionSold = Number(fractionSoldPct) / 100;
          body.overrideSaleValue = null;
        } else {
          body.fractionSold = null;
          body.overrideSaleValue = toOptionalString(overrideSaleValue as string);
        }
        body.overrideBasis = toOptionalString(overrideBasis as string);
        body.transactionCostPct = toOptionalDecimal(transactionCostPct);
        body.transactionCostFlat = toOptionalString(transactionCostFlat as string);
        body.proceedsAccountId = toOptionalString(proceedsAccountId) || null;
        // Belt-and-suspenders: never persist true for a non-real-estate sale.
        body.qualifiesForHomeSaleExclusion = isSellRealEstate && qualifiesForHomeSaleExclusion;
      }
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

    // Draft mode: emit assembled engine object without persisting.
    if (onSubmitDraft) {
      const id = isEdit && initialData ? initialData.id : crypto.randomUUID();
      onSubmitDraft(coerceAssetTransactionDraft(body, id));
      setLoading(false);
      onSaved();
      return;
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
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={isEdit ? "Edit Transaction" : "Add Asset Transaction"}
      size="lg"
      primaryAction={{
        label: isEdit ? "Save Changes" : "Save",
        form: "asset-transaction-form",
        loading: loading,
        disabled:
          loading ||
          (!sellHasData && !buyHasData) ||
          (isOrphan && !sellAccountId && !sellPurchaseTransactionId) ||
          yearBeforeBuy,
      }}
    >
      <form
        id="asset-transaction-form"
        onSubmit={handleSubmit}
        className="space-y-5"
      >
        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            {error}
          </p>
        )}

        {/* ── Common fields ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="txn-name">
              Transaction Name <span className="text-crit">*</span>
            </label>
            <input
              id="txn-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sell Home A, Buy Rental Property"
              className={inputClassName}
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
                minYear={minSellYear}
              />
            ) : (
              <>
                <label className={fieldLabelClassName} htmlFor="txn-year">
                  Year <span className="text-crit">*</span>
                </label>
                <input
                  id="txn-year"
                  type="number"
                  required
                  min={minSellYear}
                  value={year}
                  onChange={(e) => { setYear(Number(e.target.value)); setYearRef(null); }}
                  className={inputClassName}
                />
              </>
            )}
            {linkedBuy && yearBeforeBuy && (
              <p className="mt-1 text-[12px] text-crit">
                Sell year must be after buy year ({linkedBuy.year}).
              </p>
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
              {isOrphan && (
                <p className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">
                  Source removed — please re-select. The buy transaction this
                  sell referenced was deleted.
                </p>
              )}

              {/* Sell-source picker: account vs business. Hidden when no
                  sellable businesses exist in this client. */}
              {businessOptions.length > 0 && (
                <div>
                  <label className={fieldLabelClassName}>Sell source</label>
                  <div className="flex gap-1.5">
                    {([
                      { id: "account", label: "Account" },
                      { id: "business", label: "Business" },
                    ] as const).map((opt) => {
                      const active = sellMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setSellMode(opt.id);
                            if (opt.id === "business") {
                              setSellAccountId("");
                              setSellPurchaseTransactionId("");
                              // $-amount mode doesn't apply to business sales.
                              if (sellAmountMode === "dollar") {
                                setSellAmountMode("full");
                              }
                            } else {
                              setSellBusinessAccountId("");
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

              {sellMode === "business" && (
                <div className="space-y-3">
                  <div>
                    <label className={fieldLabelClassName} htmlFor="sellBusinessAccountId">
                      Business to Sell
                    </label>
                    <select
                      id="sellBusinessAccountId"
                      value={sellBusinessAccountId}
                      onChange={(e) => setSellBusinessAccountId(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">-- Select business --</option>
                      {businessOptions.map((b) => (
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
                          <div className="font-semibold text-ink-3 mb-1">
                            Owners
                          </div>
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

              {sellMode === "account" && (
              <>
              {/* Account to sell */}
              <div>
                <label className={fieldLabelClassName} htmlFor="sellAccountId">
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
              </>
              )}

              {/* Sell amount mode. Entity sales support only "full" or
                  "percent" in v1 — a $-amount sale doesn't compose with the
                  cascade (each cascaded account would need its own override). */}
              <div>
                <label className={fieldLabelClassName}>Sell amount</label>
                <div className="flex gap-1.5">
                  {(
                    sellMode === "business"
                      ? (["full", "percent"] as SellAmountMode[])
                      : (["full", "percent", "dollar"] as SellAmountMode[])
                  ).map((m) => {
                    const active = sellAmountMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSellAmountMode(m)}
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
                {sellAmountMode === "percent" && (
                  <div className="mt-2">
                    <PercentInput
                      value={fractionSoldPct}
                      onChange={(raw) => setFractionSoldPct(raw)}
                      className={`${inputClassName} w-32`}
                    />
                  </div>
                )}
                {selectedHasMortgage && sellAmountMode !== "full" && (
                  <p className="mt-2 text-[12px] text-warn">
                    Linked mortgage will not be paid off on a partial sale.
                  </p>
                )}
              </div>

              {/* Sell value: dollar amount inline, otherwise hidden under "More overrides" */}
              {sellAmountMode === "dollar" ? (
                <div>
                  <label className={fieldLabelClassName} htmlFor="overrideSaleValue">
                    Sell amount ($)
                  </label>
                  <CurrencyInput
                    id="overrideSaleValue"
                    value={overrideSaleValue}
                    onChange={(raw) => setOverrideSaleValue(raw)}
                    placeholder="Leave blank for projected"
                    className={inputClassName.replace("px-3", "pr-3")}
                  />
                  {projectedSellInfo && projectedSellInfo.projectedValue > 0 && (
                    <p className="mt-1 text-[12px] text-ink-3">
                      Projected value in {year}:{" "}
                      <span className="text-ink-2 tabular">
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
                      value={overrideBasis}
                      onChange={(raw) => setOverrideBasis(raw)}
                      placeholder="Leave blank for projected"
                      className={inputClassName.replace("px-3", "pr-3")}
                    />
                    {projectedSellInfo && projectedSellInfo.projectedBasis != null && (
                      <p className="mt-1 text-[12px] text-ink-3">
                        Projected basis in {year}:{" "}
                        <span className="text-ink-2 tabular">
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
                        value={overrideSaleValue}
                        onChange={(raw) => setOverrideSaleValue(raw)}
                        placeholder="Leave blank for projected"
                        className={inputClassName.replace("px-3", "pr-3")}
                      />
                      {projectedSellInfo && projectedSellInfo.projectedValue > 0 && (
                        <p className="mt-1 text-[12px] text-ink-3">
                          Projected value in {year}:{" "}
                          <span className="text-ink-2 tabular">
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
                        value={overrideBasis}
                        onChange={(raw) => setOverrideBasis(raw)}
                        placeholder="Leave blank for projected"
                        className={inputClassName.replace("px-3", "pr-3")}
                      />
                      {projectedSellInfo && projectedSellInfo.projectedBasis != null && (
                        <p className="mt-1 text-[12px] text-ink-3">
                          Projected basis in {year}:{" "}
                          <span className="text-ink-2 tabular">
                            {formatCurrency(projectedSellInfo.projectedBasis)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </details>
              )}

              {/* Transaction Costs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fieldLabelClassName} htmlFor="transactionCostPct">
                    Transaction Cost (%)
                  </label>
                  <PercentInput
                    id="transactionCostPct"
                    value={transactionCostPct}
                    onChange={(raw) => setTransactionCostPct(raw)}
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
                    value={transactionCostFlat}
                    onChange={(raw) => setTransactionCostFlat(raw)}
                    placeholder="Optional"
                    className={inputClassName.replace("px-3", "pr-3")}
                  />
                </div>
              </div>

              {/* Linked mortgage display for real estate */}
              {isSellRealEstate && linkedMortgage && (
                <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
                  <div>
                    <span className="font-medium">Linked Mortgage:</span>{" "}
                    {linkedMortgage.name}
                  </div>
                  <div className="mt-0.5">
                    Projected balance in {year}:{" "}
                    <span className="tabular">
                      {formatCurrency(
                        projectedMortgageBalance ?? parseNum(linkedMortgage.balance)
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-warn/70">
                    Will be paid off at sale
                  </div>
                </div>
              )}

              {/* IRC §121 home-sale exclusion — real estate sells only */}
              {isSellRealEstate && (
                <button
                  type="button"
                  onClick={() =>
                    setQualifiesForHomeSaleExclusion((v) => !v)
                  }
                  aria-pressed={qualifiesForHomeSaleExclusion}
                  className={`flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors ${
                    qualifiesForHomeSaleExclusion
                      ? "border-accent/50 bg-accent/10"
                      : "border-hair bg-card-2 hover:border-hair-2"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                      qualifiesForHomeSaleExclusion
                        ? "border-accent bg-accent text-accent-on"
                        : "border-hair-2 bg-card"
                    }`}
                  >
                    {qualifiesForHomeSaleExclusion && <CheckIcon />}
                  </span>
                  <span>
                    <span className="text-[13px] font-medium text-ink">
                      Qualifies for home-sale gain exclusion (§121)
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                      Excludes up to $250k single / $500k married-joint of capital gain on this sale. Advisor confirms 2-of-5-year eligibility.
                    </span>
                  </span>
                </button>
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
                <label className={fieldLabelClassName} htmlFor="assetName">
                  Asset Name
                </label>
                <input
                  id="assetName"
                  type="text"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="e.g., 123 Main St"
                  className={inputClassName}
                />
              </div>

              {/* Category + Sub-Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fieldLabelClassName} htmlFor="assetCategory">
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
                    className={selectClassName}
                  >
                    {(Object.keys(CATEGORY_LABELS) as AssetCategory[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabelClassName} htmlFor="assetSubType">
                    Sub-Type
                  </label>
                  <select
                    id="assetSubType"
                    value={assetSubType}
                    onChange={(e) => setAssetSubType(e.target.value)}
                    className={selectClassName}
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
                  <label className={fieldLabelClassName} htmlFor="purchasePrice">
                    Purchase Price ($)
                  </label>
                  <CurrencyInput
                    id="purchasePrice"
                    value={purchasePrice}
                    onChange={(raw) => setPurchasePrice(raw)}
                    className={inputClassName.replace("px-3", "pr-3")}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName} htmlFor="buyGrowthRate">
                    Growth Rate (%)
                  </label>
                  <PercentInput
                    id="buyGrowthRate"
                    value={buyGrowthRate}
                    onChange={(raw) => setBuyGrowthRate(raw)}
                    placeholder="e.g., 3.5"
                    className={inputClassName}
                  />
                </div>
              </div>

              {/* Basis + Funding Source */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fieldLabelClassName} htmlFor="buyBasis">
                    Basis ($)
                  </label>
                  <CurrencyInput
                    id="buyBasis"
                    value={buyBasis}
                    onChange={(raw) => setBuyBasis(raw)}
                    placeholder="Optional"
                    className={inputClassName.replace("px-3", "pr-3")}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName} htmlFor="fundingAccountId">
                    Funding Source
                  </label>
                  <select
                    id="fundingAccountId"
                    value={fundingAccountId}
                    onChange={(e) => setFundingAccountId(e.target.value)}
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
                  onClick={() => setShowMortgage((v) => !v)}
                  aria-expanded={showMortgage}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"
                >
                  <ChevronIcon expanded={showMortgage} />
                  Mortgage / Financing
                </button>

                {showMortgage && (
                  <div className="mt-3 grid grid-cols-3 gap-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-4">
                    <div>
                      <label className={fieldLabelClassName} htmlFor="mortgageAmount">
                        Amount ($)
                      </label>
                      <CurrencyInput
                        id="mortgageAmount"
                        value={mortgageAmount}
                        onChange={(raw) => setMortgageAmount(raw)}
                        className={inputClassName.replace("px-3", "pr-3")}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName} htmlFor="mortgageRate">
                        Rate (%)
                      </label>
                      <PercentInput
                        id="mortgageRate"
                        value={mortgageRate}
                        onChange={(raw) => setMortgageRate(raw)}
                        placeholder="e.g., 6.75"
                        className={inputClassName}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName} htmlFor="mortgageTermMonths">
                        Term (mo)
                      </label>
                      <input
                        id="mortgageTermMonths"
                        type="number"
                        step="1"
                        min={1}
                        value={mortgageTermMonths}
                        onChange={(e) => setMortgageTermMonths(e.target.value)}
                        className={inputClassName}
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
            <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Net Summary
              </h4>
              <div className="space-y-1 text-[13px]">
                {netSummary.hasSell && (
                  <>
                    <div className="flex justify-between text-ink-2">
                      <span>Sale Value</span>
                      <span className="tabular">{formatCurrency(netSummary.saleValue)}</span>
                    </div>
                    {netSummary.transactionCosts > 0 && (
                      <div className="flex justify-between text-ink-2">
                        <span className="pl-3">- Transaction Costs</span>
                        <span className="tabular">{formatCurrency(netSummary.transactionCosts)}</span>
                      </div>
                    )}
                    {netSummary.mortgagePayoff > 0 && (
                      <div className="flex justify-between text-ink-2">
                        <span className="pl-3">- Mortgage Payoff</span>
                        <span className="tabular">{formatCurrency(netSummary.mortgagePayoff)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium text-ink">
                      <span>Sale Proceeds</span>
                      <span className="tabular">{formatCurrency(netSummary.saleProceeds)}</span>
                    </div>
                  </>
                )}
                {netSummary.hasBuy && (
                  <>
                    {netSummary.hasSell && (
                      <div className="my-1 border-t border-hair" />
                    )}
                    <div className="flex justify-between text-ink-2">
                      <span>Purchase Price</span>
                      <span className="tabular">{formatCurrency(netSummary.purchasePrice)}</span>
                    </div>
                    {netSummary.purchaseMortgage > 0 && (
                      <div className="flex justify-between text-ink-2">
                        <span className="pl-3">- Mortgage</span>
                        <span className="tabular">{formatCurrency(netSummary.purchaseMortgage)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium text-ink">
                      <span>Cash Needed</span>
                      <span className="tabular">{formatCurrency(netSummary.purchaseCost)}</span>
                    </div>
                  </>
                )}
                {netSummary.hasSell && netSummary.hasBuy && (
                  <>
                    <div className="my-1 border-t border-hair" />
                    <div
                      className={`flex justify-between font-semibold ${
                        netSummary.net >= 0 ? "text-good" : "text-crit"
                      }`}
                    >
                      <span>Net</span>
                      <span className="tabular">
                        {netSummary.net >= 0 ? "+" : ""}
                        {formatCurrency(netSummary.net)}
                      </span>
                    </div>
                    {netSummary.net < 0 && fundingAccountId && (
                      <p className="mt-1 text-[12px] text-ink-3">
                        Deficit will be funded from{" "}
                        {fundingAccountId === "__from_sale_proceeds__"
                          ? "sale proceeds"
                          : accounts.find((a) => a.id === fundingAccountId)?.name ?? "withdrawal strategy"}
                      </p>
                    )}
                    {netSummary.net > 0 && (
                      <p className="mt-1 text-[12px] text-ink-3">
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
          {sellHasData && sellMode !== "business" && (netSummary.net > 0 || !buyHasData) && (
            <div>
              <label className={fieldLabelClassName} htmlFor="proceedsAccountId">
                Proceeds Destination
              </label>
              <select
                id="proceedsAccountId"
                value={proceedsAccountId}
                onChange={(e) => setProceedsAccountId(e.target.value)}
                className={selectClassName}
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
      </form>
    </DialogShell>
  );
}
