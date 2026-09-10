"use client";

import { useCallback, useMemo, useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useScenarioState } from "@/hooks/use-scenario-state";
import type { AssetTransaction } from "@/engine/types";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, fieldLabelClassName } from "./input-styles";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { coerceAssetTransactionDraft } from "@/lib/solver/technique-form-data";
import { bundleNameFromLegs } from "@/lib/solver/asset-transaction-bundles";
import SellLegEditor from "./asset-transaction-sell-leg";
import BuyLegEditor from "./asset-transaction-buy-leg";
import {
  type LegDraft,
  type SellLegDraft,
  type BuyLegDraft,
  emptySellLeg,
  emptyBuyLeg,
  formatCurrency,
  parseNum,
} from "./asset-transaction-leg-model";
import {
  legToBody,
  deriveLegName,
  legsFromInitialData,
  mergeEditBody,
  combinedNet,
  useProjectionYears,
} from "./use-asset-transaction-legs";

// ── Types (public surface — copied verbatim, unchanged) ─────────────────────────

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
  /** Set when this record was saved as part of a multi-leg transaction. */
  bundleId?: string | null;
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
  /** Names of existing transactions — used to seed a unique default name in add mode. */
  existingNames?: string[];
  initialData?: AssetTransactionInitialData;
  /** Every record in `initialData`'s bundle, including it. When present the
   *  dialog edits the WHOLE bundle: one leg per record, add/remove allowed,
   *  and one save writes each record back. */
  bundleRecords?: AssetTransactionInitialData[];
  /** Called for a record whose leg was removed in the dialog. Draft mode only —
   *  persisting mode issues the DELETE itself. */
  onDeleteDraft?: (recordId: string) => void;
  /** When provided, the form emits the assembled AssetTransaction engine object
   *  via this callback and does NOT persist. Add mode fans out ONE call PER LEG;
   *  edit mode calls once PER RECORD it writes. */
  onSubmitDraft?: (technique: AssetTransaction) => void;
  onClose: () => void;
  onSaved: () => void;
}

/** `writer.submit` reports a failed write in the response rather than throwing;
 *  turn one into the error the dialog shows. */
async function throwIfFailed(res: Response, fallbackMessage: string): Promise<void> {
  if (res.ok) return;
  throw new Error((await res.json()).error ?? fallbackMessage);
}

/** First unused name in the "Transaction", "Transaction 2", … sequence. */
function nextTransactionName(existing: string[] = []): string {
  const base = "Transaction";
  const taken = new Set(existing.map((n) => n.trim()));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
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
  existingNames,
  initialData,
  bundleRecords,
  onDeleteDraft,
  onSubmitDraft,
  onClose,
  onSaved,
}: AddAssetTransactionFormProps) {
  const businessOptions = useMemo(() => businesses ?? [], [businesses]);
  const pastBuys = useMemo(() => pastBuysProp ?? [], [pastBuysProp]);
  const writer = useScenarioWriter(clientId);
  const { scenarioId } = useScenarioState(clientId);
  const isEdit = !!initialData;
  const currentYear = new Date().getFullYear();

  const projectionYears = useProjectionYears(clientId, scenarioId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Ledger state ────────────────────────────────────────────────────────────
  // Edit mode operates on the whole bundle. `records` is the authoritative list:
  // the bundle when the caller knows it, else the single clicked record.
  const records = useMemo<AssetTransactionInitialData[]>(
    () => (bundleRecords?.length ? bundleRecords : initialData ? [initialData] : []),
    [bundleRecords, initialData],
  );
  const initialLegs = useMemo(() => records.flatMap(legsFromInitialData), [records]);

  const [name, setName] = useState(() =>
    records.length === 0
      ? nextTransactionName(existingNames)
      : records.length === 1
        ? records[0].name
        : bundleNameFromLegs(records),
  );
  const [year, setYear] = useState(records[0]?.year ?? currentYear);
  const [yearRef, setYearRef] = useState<YearRef | null>(null);
  const [legs, setLegs] = useState<LegDraft[]>(() =>
    initialLegs.length ? initialLegs : [emptySellLeg(crypto.randomUUID())],
  );
  const [activeLegKey, setActiveLegKey] = useState<string | null>(
    () => initialLegs[0]?.key ?? null,
  );

  const sellLegs = useMemo(
    () => legs.filter((l): l is SellLegDraft => l.kind === "sell"),
    [legs],
  );
  const buyLegs = useMemo(
    () => legs.filter((l): l is BuyLegDraft => l.kind === "buy"),
    [legs],
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  const realEstateFor = (leg: SellLegDraft): boolean =>
    accounts.find((a) => a.id === leg.sellAccountId)?.category === "real_estate";

  /** Human label for a leg's asset — feeds deriveLegName and the summary rows. */
  const assetLabelFor = (leg: LegDraft): string => {
    if (leg.kind === "buy") return leg.assetName;
    if (leg.sellMode === "business") {
      return businessOptions.find((b) => b.id === leg.sellBusinessAccountId)?.name ?? "";
    }
    if (leg.sellAccountId) {
      return accounts.find((a) => a.id === leg.sellAccountId)?.name ?? "";
    }
    if (leg.sellPurchaseTransactionId) {
      const b = pastBuys.find((p) => p.id === leg.sellPurchaseTransactionId);
      return b?.assetName ?? b?.name ?? "";
    }
    return "";
  };

  const updateLeg = (key: string, patch: Partial<LegDraft>) => {
    setLegs((prev) =>
      prev.map((l) => (l.key === key ? ({ ...l, ...patch } as LegDraft) : l)),
    );
  };

  const removeLeg = (key: string) => {
    setLegs((prev) => prev.filter((l) => l.key !== key));
    setActiveLegKey((k) => (k === key ? null : k));
  };

  const addSell = () => {
    const leg = emptySellLeg(crypto.randomUUID());
    setLegs((prev) => [...prev, leg]);
    setActiveLegKey(leg.key);
  };
  const addBuy = () => {
    const leg = emptyBuyLeg(crypto.randomUUID());
    setLegs((prev) => [...prev, leg]);
    setActiveLegKey(leg.key);
  };

  // ── Projection lookups (per sell leg, for net math + orphan checks) ─────────
  const projYear = useMemo(
    () => projectionYears?.find((py) => py.year === year) ?? null,
    [projectionYears, year],
  );

  /** Informational net proceeds for a sell leg (sale − costs − mortgage payoff). */
  const sellNetFor = useCallback(
    (leg: SellLegDraft): number => {
      const projectedValue = leg.sellAccountId
        ? projYear?.accountLedgers[leg.sellAccountId]?.beginningValue ?? 0
        : 0;
      const saleValue = parseNum(leg.overrideSaleValue) || projectedValue;

      const costPct = parseNum(leg.transactionCostPct) / 100;
      const costFlat = parseNum(leg.transactionCostFlat);
      const totalCosts = saleValue * costPct + costFlat;

      const linkedMortgage = leg.sellAccountId
        ? liabilities.find((l) => l.linkedPropertyId === leg.sellAccountId)
        : null;
      const mortgagePayoff = linkedMortgage
        ? projYear?.liabilityBalancesBoY?.[linkedMortgage.id] ??
          parseNum(linkedMortgage.balance)
        : 0;

      return saleValue - totalCosts - mortgagePayoff;
    },
    [projYear, liabilities],
  );

  /** Informational cash cost for a buy leg (price − mortgage financed). */
  const buyCostFor = useCallback(
    (leg: BuyLegDraft): number => {
      const price = parseNum(leg.purchasePrice);
      const mortgage = leg.showMortgage ? parseNum(leg.mortgageAmount) : 0;
      return price - mortgage;
    },
    [],
  );

  // ── Per-leg validity ────────────────────────────────────────────────────────
  const sellHasData = (leg: SellLegDraft): boolean =>
    leg.sellMode === "business"
      ? !!leg.sellBusinessAccountId
      : !!(leg.sellAccountId || leg.sellPurchaseTransactionId);
  const buyHasData = (leg: BuyLegDraft): boolean =>
    !!(leg.assetName || parseNum(leg.purchasePrice) > 0);

  const legHasData = (leg: LegDraft): boolean =>
    leg.kind === "sell" ? sellHasData(leg) : buyHasData(leg);

  /** An edited sell whose source was nulled by FK cascade needs re-sourcing. */
  const isOrphan = (leg: SellLegDraft): boolean =>
    !!leg.recordId &&
    isEdit &&
    !leg.sellAccountId &&
    !leg.sellPurchaseTransactionId &&
    !leg.sellBusinessAccountId;

  /** Sell year must be after a referenced past-buy's year. */
  const yearBeforeBuyFor = (leg: SellLegDraft): boolean => {
    const b = pastBuys.find((p) => p.id === leg.sellPurchaseTransactionId);
    return !!b && year <= b.year;
  };

  // Min-year floor: latest referenced past-buy across sell legs.
  const minSellYear = useMemo(() => {
    let min: number | undefined;
    for (const leg of sellLegs) {
      const b = pastBuys.find((p) => p.id === leg.sellPurchaseTransactionId);
      if (b) min = Math.max(min ?? 0, b.year + 1);
    }
    return min;
  }, [sellLegs, pastBuys]);

  const anyOrphanUnresolved = sellLegs.some(isOrphan);
  const anyYearBeforeBuy = sellLegs.some(yearBeforeBuyFor);

  const saveDisabled =
    loading ||
    legs.length === 0 ||
    legs.some((l) => !legHasData(l)) ||
    anyOrphanUnresolved ||
    anyYearBeforeBuy;

  // ── Combined net (informational footer) ─────────────────────────────────────
  const combined = useMemo(() => {
    const sellNets = sellLegs.filter(sellHasData).map(sellNetFor);
    const buyCosts = buyLegs.filter(buyHasData).map(buyCostFor);
    return combinedNet(sellNets, buyCosts);
  }, [sellLegs, buyLegs, sellNetFor, buyCostFor]);

  const showNet = sellLegs.some(sellHasData) || buyLegs.some(buyHasData);

  // ── Submit ────────────────────────────────────────────────────────────────
  /** Write ONE new record for a leg — the create path add mode and a grown
   *  bundle share. The callers differ only in the name and bundle id. */
  async function createLegRecord(
    leg: LegDraft,
    legName: string,
    bundleId: string | undefined,
  ) {
    const body = {
      ...legToBody({ ...leg, name: legName }, year, {
        isRealEstate: leg.kind === "sell" ? realEstateFor(leg) : false,
      }),
      ...(bundleId ? { bundleId } : {}),
    };
    const id = crypto.randomUUID();
    if (onSubmitDraft) {
      onSubmitDraft(coerceAssetTransactionDraft(body, id));
      return;
    }
    await throwIfFailed(
      await writer.submit(
        { op: "add", targetKind: "asset_transaction", entity: { id, ...body } },
        { url: `/api/clients/${clientId}/asset-transactions`, method: "POST", body },
      ),
      "Failed to save transaction",
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isEdit && records.length > 0) {
        // One record per surviving recordId (a legacy swap row keeps BOTH of its
        // legs and merges back into itself), plus creates for new legs and
        // deletes for records whose leg was dropped.
        const byRecord = new Map<string, LegDraft[]>();
        const created: LegDraft[] = [];
        for (const leg of legs) {
          if (leg.recordId) {
            const list = byRecord.get(leg.recordId);
            if (list) list.push(leg);
            else byRecord.set(leg.recordId, [leg]);
          } else created.push(leg);
        }
        const dropped = records.filter((r) => !byRecord.has(r.id));

        // Dropping a record needs somewhere to send the delete — in draft mode
        // that is `onDeleteDraft`. Without it the leg the advisor removed would
        // quietly survive the save, so refuse the whole save and say so.
        if (dropped.length > 0 && onSubmitDraft && !onDeleteDraft) {
          throw new Error(
            "Can't remove that leg here. Delete it from the Techniques list instead.",
          );
        }

        // A legacy swap row is ONE record holding two legs — it is not a bundle,
        // and must save back under its own name, unchanged. So both the bundle
        // id and the derived-name decision count RECORDS, never legs.
        const recordCount = byRecord.size + created.length;
        // Only a bundle-aware caller — one whose `bundleRecords` is what
        // `records` came from — may mint an id. A caller that passed a single
        // record without knowing its bundle would otherwise stamp a NEW id over
        // the record's real one, silently pulling it out of its bundle and
        // orphaning the siblings still carrying the old id.
        const bundleAware = !!bundleRecords?.length;
        const bundleId =
          records.find((r) => r.bundleId)?.bundleId ??
          (bundleAware && recordCount > 1 ? crypto.randomUUID() : undefined);
        // A multi-record transaction derives every leg's name from the shared
        // name — so renaming the transaction renames each leg; a lone record
        // keeps the name field verbatim.
        const multi = recordCount > 1;
        const legNameFor = (leg: LegDraft): string =>
          multi ? deriveLegName(leg, name, { assetLabel: assetLabelFor(leg) }) : name;

        for (const [recordId, recordLegs] of byRecord) {
          const sell = recordLegs.find((l): l is SellLegDraft => l.kind === "sell");
          const body = {
            ...mergeEditBody(recordLegs, legNameFor(recordLegs[0]), year, {
              isRealEstate: sell ? realEstateFor(sell) : false,
            }),
            ...(bundleId ? { bundleId } : {}),
          };
          if (onSubmitDraft) {
            onSubmitDraft(coerceAssetTransactionDraft(body, recordId));
          } else {
            await throwIfFailed(
              await writer.submit(
                {
                  op: "edit",
                  targetKind: "asset_transaction",
                  targetId: recordId,
                  desiredFields: body,
                },
                {
                  url: `/api/clients/${clientId}/asset-transactions`,
                  method: "PUT",
                  body: { ...body, transactionId: recordId },
                },
              ),
              "Failed to save transaction",
            );
          }
        }

        for (const leg of created) {
          await createLegRecord(leg, legNameFor(leg), bundleId);
        }

        for (const record of dropped) {
          if (onSubmitDraft) {
            // The guard above already proved a handler exists.
            onDeleteDraft?.(record.id);
          } else {
            await throwIfFailed(
              await writer.submit(
                { op: "remove", targetKind: "asset_transaction", targetId: record.id },
                {
                  url: `/api/clients/${clientId}/asset-transactions?transactionId=${record.id}`,
                  method: "DELETE",
                },
              ),
              "Failed to delete transaction",
            );
          }
        }
      } else {
        // Add mode — fan out to N records that share ONE bundle id, so the
        // Techniques list can render them as a single technique.
        const bundleId = crypto.randomUUID();
        for (const leg of legs) {
          await createLegRecord(
            leg,
            deriveLegName(leg, name, { assetLabel: assetLabelFor(leg) }),
            bundleId,
          );
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ── Focused editor for the active leg ─────────────────────────────────────
  const activeLeg = legs.find((l) => l.key === activeLegKey) ?? null;

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={isEdit ? "Edit Transaction" : "Add Asset Transactions"}
      size="lg"
      primaryAction={{
        label: isEdit ? "Save Changes" : "Save",
        form: "asset-transaction-form",
        loading,
        disabled: saveDisabled,
      }}
    >
      <form id="asset-transaction-form" onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            {error}
          </p>
        )}

        {/* ── Shared name + year ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 items-start gap-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="txn-name">
              Name <span className="text-crit">*</span>
            </label>
            <input
              id="txn-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Downsize 2030"
              className={inputClassName}
            />
          </div>

          <div>
            {milestones ? (
              <MilestoneYearPicker
                name="txn-year"
                id="txn-year"
                value={year}
                yearRef={yearRef}
                milestones={milestones}
                onChange={(y, r) => {
                  setYear(y);
                  setYearRef(r);
                }}
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
                  onChange={(e) => {
                    setYear(Number(e.target.value));
                    setYearRef(null);
                  }}
                  className={inputClassName}
                />
              </>
            )}
            {anyYearBeforeBuy && minSellYear != null && (
              <p className="mt-1 text-[12px] text-crit">
                Sell year must be after {minSellYear - 1} (the referenced buy year).
              </p>
            )}
          </div>
        </div>

        {/* ── Three-column ledger: sell · editor · buy ────────────────────── */}
        <div className="grid grid-cols-[180px_minmax(0,1fr)_180px] items-start gap-4">
          {/* Sell column */}
          <LedgerColumn
            testId="sell-column"
            title="Sell"
            accent="crit"
            emptyLabel="No sell legs"
            subtotalLabel="Sale proceeds"
            subtotal={combined.proceeds}
            activeKey={activeLegKey}
            rows={sellLegs.map((leg) => ({
              key: leg.key,
              label: assetLabelFor(leg) || "New sale",
              net: sellHasData(leg) ? sellNetFor(leg) : 0,
              hasData: sellHasData(leg),
            }))}
            onEdit={setActiveLegKey}
            onRemove={removeLeg}
            onAdd={addSell}
            addLabel="Add sell"
          />

          {/* Editor column — shared surface for the active sell or buy leg */}
          <div
            className={`min-h-[300px] rounded-[var(--radius-sm)] border p-4 transition-colors ${
              activeLeg
                ? activeLeg.kind === "sell"
                  ? "border-crit/30 bg-crit/5"
                  : "border-good/30 bg-good/5"
                : "border-dashed border-hair bg-card-2"
            }`}
          >
            {activeLeg ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h4
                    className={`text-[13px] font-semibold ${
                      activeLeg.kind === "sell" ? "text-crit" : "text-good"
                    }`}
                  >
                    {activeLeg.kind === "sell" ? "Edit sell leg" : "Edit buy leg"}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setActiveLegKey(null)}
                    className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1 text-[12px] font-medium text-ink-2 hover:border-hair-2 hover:text-ink"
                  >
                    Done
                  </button>
                </div>
                {activeLeg.kind === "sell" ? (
                  <SellLegEditor
                    leg={activeLeg}
                    year={year}
                    onChange={(patch) => updateLeg(activeLeg.key, patch)}
                    accounts={accounts}
                    liabilities={liabilities}
                    businesses={businessOptions}
                    pastBuys={pastBuys}
                    projectionYears={projectionYears}
                    isOrphan={isOrphan(activeLeg)}
                  />
                ) : (
                  <BuyLegEditor
                    leg={activeLeg}
                    onChange={(patch) => updateLeg(activeLeg.key, patch)}
                    accounts={accounts}
                  />
                )}
              </>
            ) : (
              <div className="flex min-h-[268px] flex-col items-center justify-center gap-1 text-center">
                <p className="text-[13px] font-medium text-ink-2">Nothing selected</p>
                <p className="max-w-[240px] text-[12px] text-ink-3">
                  Choose a sell or buy leg to edit it here, or add one on either
                  side.
                </p>
              </div>
            )}
          </div>

          {/* Buy column */}
          <LedgerColumn
            testId="buy-column"
            title="Buy"
            accent="good"
            emptyLabel="No buy legs"
            subtotalLabel="Cash needed"
            subtotal={combined.purchases}
            activeKey={activeLegKey}
            rows={buyLegs.map((leg) => ({
              key: leg.key,
              label: assetLabelFor(leg) || "New purchase",
              net: buyHasData(leg) ? buyCostFor(leg) : 0,
              hasData: buyHasData(leg),
            }))}
            onEdit={setActiveLegKey}
            onRemove={removeLeg}
            onAdd={addBuy}
            addLabel="Add buy"
          />
        </div>

        {/* ── Combined-net footer (informational) ────────────────────────── */}
        {showNet && (
          <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-ink-2">Combined net</span>
              <span
                className={`font-semibold tabular-nums ${
                  combined.net >= 0 ? "text-good" : "text-crit"
                }`}
              >
                {combined.net >= 0 ? "+" : ""}
                {formatCurrency(combined.net)}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-ink-3">
              Proceeds{" "}
              <span className="tabular-nums">{formatCurrency(combined.proceeds)}</span>
              {" "}−{" "}cash needed{" "}
              <span className="tabular-nums">{formatCurrency(combined.purchases)}</span>
              . Pre-tax estimate.
            </p>
          </div>
        )}
      </form>
    </DialogShell>
  );
}

// ── Ledger column ─────────────────────────────────────────────────────────────

interface LedgerRow {
  key: string;
  label: string;
  net: number;
  hasData: boolean;
}

function LedgerColumn({
  testId,
  title,
  accent,
  emptyLabel,
  subtotalLabel,
  subtotal,
  activeKey,
  rows,
  onEdit,
  onRemove,
  onAdd,
  addLabel,
}: {
  testId: string;
  title: string;
  accent: "crit" | "good";
  emptyLabel: string;
  subtotalLabel: string;
  subtotal: number;
  activeKey: string | null;
  rows: LedgerRow[];
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
  onAdd?: () => void;
  addLabel: string;
}) {
  const headText = accent === "crit" ? "text-crit" : "text-good";
  const surface = accent === "crit" ? "border-crit/30 bg-crit/5" : "border-good/30 bg-good/5";
  const activeRow =
    accent === "crit" ? "border-crit/60 bg-crit/15" : "border-good/60 bg-good/15";

  return (
    <div
      data-testid={testId}
      className={`flex flex-col gap-2 rounded-[var(--radius-sm)] border ${surface} p-3`}
    >
      <h3 className={`text-[13px] font-semibold ${headText}`}>{title}</h3>

      <ul className="space-y-1.5">
        {rows.length === 0 && (
          <li className="rounded-[var(--radius-sm)] border border-dashed border-hair px-3 py-2 text-[12px] text-ink-3">
            {emptyLabel}
          </li>
        )}
        {rows.map((row) => {
          const isActive = row.key === activeKey;
          return (
            <li key={row.key} className="flex items-stretch gap-1">
              {/* Whole row selects the leg into the middle editor. */}
              <button
                type="button"
                onClick={() => onEdit(row.key)}
                aria-pressed={isActive}
                className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors ${
                  isActive ? activeRow : "border-hair bg-card hover:border-hair-2"
                }`}
              >
                <span className="min-w-0 truncate text-[13px] text-ink">{row.label}</span>
                <span
                  className={`text-[11px] tabular-nums ${
                    row.hasData ? "text-ink-2" : "text-ink-4"
                  }`}
                >
                  {row.hasData ? formatCurrency(row.net) : "—"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(row.key)}
                aria-label={`Remove ${row.label}`}
                className="flex w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair bg-card-2 text-ink-3 transition-colors hover:border-crit/40 hover:text-crit"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-1 flex items-center justify-between gap-1 border-t border-hair pt-2 text-[11px]">
        <span className="truncate text-ink-3">{subtotalLabel}</span>
        <span className="shrink-0 font-medium tabular-nums text-ink-2">
          {formatCurrency(subtotal)}
        </span>
      </div>

      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className={`mt-1 rounded-[var(--radius-sm)] border border-dashed px-3 py-1.5 text-[12px] font-medium transition-colors ${
            accent === "crit"
              ? "border-crit/40 text-crit hover:bg-crit/10"
              : "border-good/40 text-good hover:bg-good/10"
          }`}
        >
          + {addLabel}
        </button>
      )}
    </div>
  );
}
