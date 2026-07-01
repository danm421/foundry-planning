"use client";

import { useState, useMemo, useEffect, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type { RothConversionType, RothConversion, Account } from "@/engine/types";
import type { GrowthSource } from "@/lib/investments/allocation";
import { GrowthRateField, parseGrowthSourceSelection } from "./growth-rate-field";

const ROTH_SUBTYPES = new Set(["roth_ira"]);
const TAX_DEFERRED_SUBTYPES = new Set(["traditional_ira", "401k", "403b", "sep_ira", "simple_ira"]);

const CONVERSION_TYPE_OPTIONS: { value: RothConversionType; label: string; sub: string }[] = [
  { value: "fixed_amount", label: "Fixed Amount", sub: "Convert a set dollar amount each year" },
  { value: "full_account", label: "Full Account Value", sub: "Convert the entire source pool in year 1" },
  { value: "deplete_over_period", label: "Deplete Over Period", sub: "Spread the source pool evenly over the window" },
  { value: "fill_up_bracket", label: "Fill Up Tax Bracket", sub: "Convert just enough to top out the chosen bracket" },
];

const BRACKET_OPTIONS = [
  { value: 0.10, label: "10% bracket" },
  { value: 0.12, label: "12% bracket" },
  { value: 0.22, label: "22% bracket" },
  { value: 0.24, label: "24% bracket" },
  { value: 0.32, label: "32% bracket" },
  { value: 0.35, label: "35% bracket" },
  { value: 0.37, label: "37% bracket" },
];

export interface RothConversionInitialData {
  id: string;
  name: string;
  destinationAccountId: string;
  sourceAccountIds: string[];
  conversionType: RothConversionType;
  fixedAmount: string;
  fillUpBracket: string | null;
  startYear: number;
  startYearRef: string | null;
  endYear: number | null;
  endYearRef: string | null;
  indexingRate: string;
  inflationStartYear: number | null;
}

export interface RothAccountCreation {
  owners: { familyMemberId: string; label: string }[];
  modelPortfolios: { id: string; name: string; growthRate: number }[];
  retirementGrowthDefault: number;
  resolvedInflationRate: number;
  onCreate: (account: Account) => void;
}

interface Props {
  clientId: string;
  accounts: {
    id: string;
    name: string;
    category: string;
    subType: string;
    /** Controlling family-member id when the account is 100% owned by a single
     *  person (else null/undefined). Used to restrict conversion sources to
     *  accounts owned by the same person as the destination Roth IRA. */
    ownerFamilyMemberId?: string | null;
  }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialData?: RothConversionInitialData;
  rothAccountCreation?: RothAccountCreation;   // solver-only: enables inline Roth-IRA creation
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the form emits the assembled RothConversion engine object
   *  via this callback instead of persisting. No fetch is made. */
  onSubmitDraft?: (technique: RothConversion) => void;
}

export default function AddRothConversionForm({
  clientId,
  accounts,
  milestones,
  clientFirstName,
  spouseFirstName,
  initialData,
  rothAccountCreation,
  onClose,
  onSaved,
  onSubmitDraft,
}: Props) {
  const writer = useScenarioWriter(clientId);

  const [newRothAccounts, setNewRothAccounts] = useState<Account[]>([]);
  const [addingRoth, setAddingRoth] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState(
    rothAccountCreation?.owners[0]?.familyMemberId ?? "",
  );
  const [newGrowthSource, setNewGrowthSource] = useState<GrowthSource>("default");
  const [newModelPortfolioId, setNewModelPortfolioId] = useState("");
  const [newGrowthPct, setNewGrowthPct] = useState("");

  const allAccounts = useMemo(() => {
    const localRows = newRothAccounts.map((a) => {
      const o = a.owners[0];
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        subType: a.subType,
        ownerFamilyMemberId: o && o.kind === "family_member" ? o.familyMemberId : null,
      };
    });
    return [...accounts, ...localRows];
  }, [accounts, newRothAccounts]);

  const rothAccounts = useMemo(
    () => allAccounts.filter((a) => a.category === "retirement" && ROTH_SUBTYPES.has(a.subType)),
    [allAccounts],
  );
  const taxDeferredAccounts = useMemo(
    () => allAccounts.filter((a) => a.category === "retirement" && TAX_DEFERRED_SUBTYPES.has(a.subType)),
    [allAccounts],
  );

  const [name, setName] = useState(initialData?.name ?? "Roth Conversion");
  const [destinationAccountId, setDestinationAccountId] = useState(
    initialData?.destinationAccountId ?? rothAccounts[0]?.id ?? "",
  );
  const [conversionType, setConversionType] = useState<RothConversionType>(
    initialData?.conversionType ?? "fixed_amount",
  );
  const [fixedAmount, setFixedAmount] = useState(initialData?.fixedAmount ?? "");
  const [fillUpBracket, setFillUpBracket] = useState<number>(
    initialData?.fillUpBracket != null ? parseFloat(initialData.fillUpBracket) : 0.22,
  );
  const [startYear, setStartYear] = useState(
    initialData?.startYear ?? new Date().getFullYear(),
  );
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (initialData?.startYearRef as YearRef | null) ?? null,
  );
  const [endYear, setEndYear] = useState<number>(
    initialData?.endYear ?? new Date().getFullYear() + 5,
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (initialData?.endYearRef as YearRef | null) ?? null,
  );
  const [indexingRate, setIndexingRate] = useState(
    initialData ? (parseFloat(initialData.indexingRate) * 100).toString() : "0",
  );
  const [startIndexingMode, setStartIndexingMode] = useState<"immediately" | "at_start">(
    initialData?.inflationStartYear == null ? "immediately" : "at_start",
  );
  const [sourceAccountIds, setSourceAccountIds] = useState<string[]>(
    initialData?.sourceAccountIds ?? [],
  );
  const [submitting, setSubmitting] = useState(false);

  const requiresEndYear = conversionType === "deplete_over_period";
  const showFixedAmount = conversionType === "fixed_amount";
  const showBracketSelect = conversionType === "fill_up_bracket";
  const showIndexing = conversionType === "fixed_amount";

  const accountMap = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);

  const canCreateRoth = !!rothAccountCreation && rothAccountCreation.owners.length > 0;
  const showRothPanel = canCreateRoth && (addingRoth || rothAccounts.length === 0);
  const showNewRothButton = canCreateRoth && rothAccounts.length > 0 && !addingRoth;

  function resolveNewGrowthRate(): number {
    if (!rothAccountCreation) return 0;
    if (newGrowthSource === "model_portfolio") {
      return (
        rothAccountCreation.modelPortfolios.find((p) => p.id === newModelPortfolioId)?.growthRate ??
        rothAccountCreation.retirementGrowthDefault
      );
    }
    if (newGrowthSource === "inflation") return rothAccountCreation.resolvedInflationRate;
    if (newGrowthSource === "custom") return (parseFloat(newGrowthPct) || 0) / 100;
    return rothAccountCreation.retirementGrowthDefault;
  }

  function handleCreateRoth() {
    if (!rothAccountCreation || !newOwnerId) return;
    const ownerLabel =
      rothAccountCreation.owners.find((o) => o.familyMemberId === newOwnerId)?.label ?? "";
    const account: Account = {
      id: crypto.randomUUID(),
      name: `Roth IRA - ${ownerLabel}`,
      category: "retirement",
      subType: "roth_ira",
      value: 0,
      basis: 0,
      growthRate: resolveNewGrowthRate(),
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: newOwnerId, percent: 1 }],
    };
    rothAccountCreation.onCreate(account);
    setNewRothAccounts((prev) => [...prev, account]);
    setDestinationAccountId(account.id);
    setAddingRoth(false);
    setNewGrowthSource("default");
    setNewModelPortfolioId("");
    setNewGrowthPct("");
  }

  // A Roth IRA is owned by a single person, so a conversion may only draw from
  // tax-deferred accounts owned by that same person. Filter the source list to
  // the destination's owner — the spouse's (or anyone else's) accounts don't
  // even appear as options. Falls back to showing everything when owner data
  // is unavailable (e.g. legacy accounts whose owner can't be determined).
  const destOwner = useMemo(
    () => accountMap.get(destinationAccountId)?.ownerFamilyMemberId ?? null,
    [accountMap, destinationAccountId],
  );
  const eligibleSources = useMemo(
    () =>
      taxDeferredAccounts.filter((a) => {
        const srcOwner = a.ownerFamilyMemberId ?? null;
        return destOwner == null || srcOwner == null || srcOwner === destOwner;
      }),
    [taxDeferredAccounts, destOwner],
  );

  // Drop any already-selected sources that the destination change just made
  // ineligible, so a hidden mismatched source can't be silently submitted.
  useEffect(() => {
    const eligibleIds = new Set(eligibleSources.map((a) => a.id));
    setSourceAccountIds((curr) => {
      const next = curr.filter((id) => eligibleIds.has(id));
      return next.length === curr.length ? curr : next;
    });
  }, [eligibleSources]);

  function toggleSource(id: string) {
    setSourceAccountIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  }

  function moveSource(id: string, dir: -1 | 1) {
    setSourceAccountIds((curr) => {
      const idx = curr.indexOf(id);
      if (idx < 0) return curr;
      const target = idx + dir;
      if (target < 0 || target >= curr.length) return curr;
      const copy = [...curr];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!destinationAccountId) {
      alert("Pick a destination Roth account before saving.");
      return;
    }
    if (sourceAccountIds.length === 0) {
      alert("Pick at least one source account.");
      return;
    }
    if (showFixedAmount && (!fixedAmount || parseFloat(fixedAmount) <= 0)) {
      alert("Enter a fixed amount greater than zero.");
      return;
    }
    if (requiresEndYear && endYear <= startYear - 1) {
      alert("End year must be on or after start year.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name,
        destinationAccountId,
        sourceAccountIds,
        conversionType,
        fixedAmount: showFixedAmount ? parseFloat(fixedAmount) || 0 : 0,
        fillUpBracket: showBracketSelect ? fillUpBracket : null,
        startYear,
        endYear: requiresEndYear || conversionType === "fill_up_bracket" || conversionType === "fixed_amount"
          ? endYear
          : null,
        startYearRef,
        endYearRef:
          requiresEndYear || conversionType === "fill_up_bracket" || conversionType === "fixed_amount"
            ? endYearRef
            : null,
        indexingRate: showIndexing ? (parseFloat(indexingRate) || 0) / 100 : 0,
        inflationStartYear:
          showIndexing && startIndexingMode === "at_start" ? startYear : null,
      };

      if (onSubmitDraft) {
        const technique: RothConversion = {
          id: initialData?.id ?? crypto.randomUUID(),
          name: body.name,
          destinationAccountId: body.destinationAccountId,
          sourceAccountIds: body.sourceAccountIds,
          conversionType: body.conversionType,
          fixedAmount: body.fixedAmount,
          ...(body.fillUpBracket != null ? { fillUpBracket: body.fillUpBracket } : {}),
          startYear: body.startYear,
          ...(body.endYear != null ? { endYear: body.endYear } : {}),
          indexingRate: body.indexingRate,
          ...(body.inflationStartYear != null ? { inflationStartYear: body.inflationStartYear } : {}),
          ...(body.startYearRef != null ? { startYearRef: body.startYearRef } : {}),
          ...(body.endYearRef != null ? { endYearRef: body.endYearRef } : {}),
        };
        onSubmitDraft(technique);
        onSaved();
        return;
      }

      const baseUrl = `/api/clients/${clientId}/roth-conversions`;
      const baseMethod = initialData ? "PUT" : "POST";
      const basePayload = initialData
        ? { rothConversionId: initialData.id, ...body }
        : body;

      const res = initialData
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "roth_conversion",
              targetId: initialData.id,
              desiredFields: body,
            },
            { url: baseUrl, method: baseMethod, body: basePayload },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "roth_conversion",
              entity: { id: crypto.randomUUID(), ...body },
            },
            { url: baseUrl, method: baseMethod, body: basePayload },
          );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to save: ${(err as { error?: string }).error ?? res.statusText}`);
        return;
      }

      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={initialData ? "Edit Roth Conversion" : "New Roth Conversion"}
      size="lg"
      primaryAction={{
        label: initialData ? "Save Changes" : "Add Conversion",
        form: "roth-conversion-form",
        loading: submitting,
        disabled: submitting || rothAccounts.length === 0,
      }}
    >
      <form id="roth-conversion-form" onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div>
          <label className={fieldLabelClassName} htmlFor="rc-name">
            Name
          </label>
          <input
            id="rc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Roth Conversion 1"
            required
            className={inputClassName}
          />
        </div>

        {/* Years */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {milestones ? (
              <MilestoneYearPicker
                name="startYear"
                id="rc-startYear"
                value={startYear}
                yearRef={startYearRef}
                milestones={milestones}
                onChange={(y, r) => { setStartYear(y); setStartYearRef(r); }}
                label="Starts"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName}
                position="start"
              />
            ) : (
              <>
                <label className={fieldLabelClassName} htmlFor="rc-startYear">Starts</label>
                <input
                  id="rc-startYear"
                  type="number"
                  min={2000}
                  max={2100}
                  value={startYear}
                  onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                  className={inputClassName}
                />
              </>
            )}
          </div>
          <div>
            {milestones ? (
              <MilestoneYearPicker
                name="endYear"
                id="rc-endYear"
                value={endYear}
                yearRef={endYearRef}
                milestones={milestones}
                onChange={(y, r) => { setEndYear(y); setEndYearRef(r); }}
                label="Ends"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName}
                startYearForDuration={startYear}
                position="end"
              />
            ) : (
              <>
                <label className={fieldLabelClassName} htmlFor="rc-endYear">Ends</label>
                <input
                  id="rc-endYear"
                  type="number"
                  min={2000}
                  max={2100}
                  value={endYear}
                  onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                  className={inputClassName}
                />
              </>
            )}
          </div>
        </div>

        {/* Destination */}
        <div>
          <label className={fieldLabelClassName} htmlFor="rc-destination">Destination Account</label>
          {rothAccounts.length > 0 ? (
            <select
              id="rc-destination"
              value={destinationAccountId}
              onChange={(e) => setDestinationAccountId(e.target.value)}
              className={selectClassName}
              required
            >
              {rothAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          ) : canCreateRoth ? null : (
            <p className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
              No Roth account on this plan yet. Add a Roth IRA or Roth 401(k) account first.
            </p>
          )}

          {showNewRothButton && (
            <button
              type="button"
              onClick={() => setAddingRoth(true)}
              className="mt-2 rounded-[var(--radius-sm)] border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-accent hover:border-accent/60"
            >
              + New Roth IRA
            </button>
          )}

          {showRothPanel && rothAccountCreation && (
            <div
              role="group"
              aria-label="New Roth IRA account"
              className="mt-2 space-y-3 rounded-[var(--radius-sm)] border border-hair-2 bg-card-2 p-3"
            >
              <div>
                <label className={fieldLabelClassName} htmlFor="rc-new-owner">Owner</label>
                <select
                  id="rc-new-owner"
                  aria-label="Roth IRA owner"
                  value={newOwnerId}
                  onChange={(e) => setNewOwnerId(e.target.value)}
                  className={selectClassName}
                >
                  {rothAccountCreation.owners.map((o) => (
                    <option key={o.familyMemberId} value={o.familyMemberId}>{o.label}</option>
                  ))}
                </select>
              </div>
              <GrowthRateField
                category="retirement"
                growthSource={newGrowthSource}
                modelPortfolioId={newModelPortfolioId}
                growthRatePct={newGrowthPct}
                modelPortfolios={rothAccountCreation.modelPortfolios.map((p) => ({
                  id: p.id,
                  name: p.name,
                  blendedReturn: p.growthRate,
                }))}
                defaultPctForCategory={Math.round(rothAccountCreation.retirementGrowthDefault * 10000) / 100}
                catDefaultPortfolioName={null}
                resolvedInflationRate={rothAccountCreation.resolvedInflationRate}
                assetMixBlendedPct={null}
                hideAssetMix
                onSourceChange={(raw) => {
                  const parsed = parseGrowthSourceSelection(raw);
                  setNewGrowthSource(parsed.growthSource);
                  setNewModelPortfolioId(parsed.modelPortfolioId ?? "");
                }}
                onCustomPctChange={setNewGrowthPct}
              />
              <p className="text-[11px] text-ink-3">
                Creates a Roth IRA named &ldquo;Roth IRA - {rothAccountCreation.owners.find((o) => o.familyMemberId === newOwnerId)?.label ?? ""}&rdquo; with a $0 starting balance.
              </p>
              <div className="flex justify-end gap-2">
                {rothAccounts.length > 0 && (
                  <button type="button" onClick={() => setAddingRoth(false)} className="px-3 py-1 text-[12px] text-ink-3">
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCreateRoth}
                  disabled={!newOwnerId}
                  className="rounded bg-accent/20 px-3 py-1 text-[12px] font-medium text-ink disabled:opacity-40"
                >
                  Create Roth IRA
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Conversion type — segmented control */}
        <div>
          <label className={fieldLabelClassName}>Conversion Type</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONVERSION_TYPE_OPTIONS.map((opt) => {
              const active = conversionType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setConversionType(opt.value)}
                  aria-pressed={active}
                  className={`rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-accent/50 bg-accent/10"
                      : "border-hair bg-card-2 hover:border-hair-2"
                  }`}
                >
                  <div
                    className={`text-[13px] font-semibold ${
                      active ? "text-accent-ink" : "text-ink-2"
                    }`}
                  >
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-tight text-ink-3">
                    {opt.sub}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Fixed amount */}
        {showFixedAmount && (
          <div>
            <label htmlFor="rc-fixedAmount" className={fieldLabelClassName}>Fixed Amount ($/yr)</label>
            <CurrencyInput
              id="rc-fixedAmount"
              value={fixedAmount}
              onChange={(raw) => setFixedAmount(raw)}
              required
              className={inputClassName}
            />
          </div>
        )}

        {/* Bracket selector */}
        {showBracketSelect && (
          <div>
            <label className={fieldLabelClassName} htmlFor="rc-bracket">Fill Up To</label>
            <select
              id="rc-bracket"
              value={fillUpBracket}
              onChange={(e) => setFillUpBracket(parseFloat(e.target.value))}
              className={selectClassName}
            >
              {BRACKET_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-ink-3">
              Each year, convert just enough to top out the selected ordinary-income bracket.
            </p>
          </div>
        )}

        {/* Indexing — fixed_amount only */}
        {showIndexing && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabelClassName} htmlFor="rc-indexingRate">Indexed At (% / yr)</label>
              <PercentInput
                id="rc-indexingRate"
                value={indexingRate}
                onChange={(raw) => setIndexingRate(raw)}
                className={inputClassName}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="rc-indexingMode">Start Indexing</label>
              <select
                id="rc-indexingMode"
                value={startIndexingMode}
                onChange={(e) => setStartIndexingMode(e.target.value as "immediately" | "at_start")}
                className={selectClassName}
              >
                <option value="immediately">Immediately</option>
                <option value="at_start">At Start Year</option>
              </select>
            </div>
          </div>
        )}

        {/* Accounts to convert */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label className="block text-[13px] font-medium text-ink-2">Accounts to Convert</label>
            <span className="text-[11px] text-ink-3">
              Drained in order. Use ↑ ↓ to reorder.
            </span>
          </div>
          {eligibleSources.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
              No Traditional IRA / 401(k) / SEP / SIMPLE accounts available.
            </p>
          ) : (
            <div className="space-y-1.5">
              {/* Selected sources, in order */}
              {sourceAccountIds.map((id, idx) => {
                const a = accountMap.get(id);
                if (!a) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between rounded-[var(--radius-sm)] border border-accent/50 bg-accent/10 px-3 py-2 text-[13px] text-ink"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-ink-3">{idx + 1}.</span>
                      <span className="text-accent-ink">{a.name}</span>
                      <span className="text-[11px] text-ink-3">({a.subType})</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveSource(id, -1)}
                        className="px-1 text-ink-3 hover:text-ink disabled:opacity-30"
                        aria-label="Move up"
                      >↑</button>
                      <button
                        type="button"
                        disabled={idx === sourceAccountIds.length - 1}
                        onClick={() => moveSource(id, 1)}
                        className="px-1 text-ink-3 hover:text-ink disabled:opacity-30"
                        aria-label="Move down"
                      >↓</button>
                      <button
                        type="button"
                        onClick={() => toggleSource(id)}
                        className="px-1 text-white hover:opacity-80"
                        aria-label="Remove"
                      >×</button>
                    </div>
                  </div>
                );
              })}
              {/* Unselected sources */}
              {eligibleSources
                .filter((a) => !sourceAccountIds.includes(a.id))
                .map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => toggleSource(a.id)}
                    className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
                  >
                    <span>
                      {a.name}{" "}
                      <span className="text-[11px] text-ink-3">({a.subType})</span>
                    </span>
                    <span className="text-accent-ink">+ Add</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
