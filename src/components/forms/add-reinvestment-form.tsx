"use client";

import { useState, useEffect, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type { Reinvestment } from "@/engine/types";
import { isLiquid, type AccountCategory } from "@/lib/account-groups/liquid-filter";
import { DEFAULT_GROUP_KEYS, DEFAULT_NAMES } from "@/lib/account-groups/resolver";

/**
 * Shape passed in when editing. The card-level fields come straight from
 * `ReinvestmentRow`. The DB-backed edit path leaves the detail fields
 * (`modelPortfolioId`, `customGrowthRate`, custom realization percents)
 * undefined and the form re-fetches them from `GET /api/clients/:id/reinvestments`
 * on mount. The solver's draft path can't fetch (drafts aren't persisted), so it
 * supplies the detail fields directly off the in-memory engine object instead.
 */
export interface ReinvestmentInitialData {
  id: string;
  name: string;
  accountIds: string[];
  groupKeys?: string[];
  year: number;
  yearRef: string | null;
  targetType: "model_portfolio" | "custom";
  realizeTaxesOnSwitch: boolean;
  // Detail fields — provided by the draft path; omitted by the DB path. Decimal
  // fractions (engine-shaped), matching the `Reinvestment` resolution inputs.
  modelPortfolioId?: string | null;
  customGrowthRate?: number | null;
  customPctOrdinaryIncome?: number | null;
  customPctLtCapitalGains?: number | null;
  customPctQualifiedDividends?: number | null;
  customPctTaxExempt?: number | null;
}

interface AddReinvestmentFormProps {
  clientId: string;
  accounts: { id: string; name: string; category: string; subType: string }[];
  modelPortfolios: { id: string; name: string; growthRate?: number }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialData?: ReinvestmentInitialData;
  onClose: () => void;
  onSaved: () => void;
  /**
   * When provided, the form emits the assembled `Reinvestment` engine object
   * via this callback instead of persisting to the server. The caller (e.g.
   * a solver techniques panel) receives the draft to store in local state.
   * When absent, behavior is 100% unchanged — the form saves normally.
   */
  onSubmitDraft?: (technique: Reinvestment) => void;
}

const DEFAULT_GROUPS = [...DEFAULT_GROUP_KEYS].map((key) => ({
  key,
  label: DEFAULT_NAMES[key],
}));

const TARGET_OPTIONS: {
  value: "model_portfolio" | "custom";
  label: string;
  sub: string;
}[] = [
  {
    value: "model_portfolio",
    label: "Model portfolio",
    sub: "Reallocate to a saved model",
  },
  {
    value: "custom",
    label: "Custom growth rate",
    sub: "Set an explicit return assumption",
  },
];

function makeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tmp-${Date.now()}`;
}

/** Convert a stored decimal fraction (e.g. "0.06") to a percent string ("6"). */
function toPercentString(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  return String(num * 100);
}

/** 12×12 check glyph for the account selector rows. */
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

function SelectorButton({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[13px] transition-colors ${
        selected
          ? "border-accent/50 bg-accent/10 text-ink"
          : "border-hair bg-card-2 text-ink-2 hover:border-hair-2 hover:text-ink"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
          selected ? "border-accent bg-accent text-accent-on" : "border-hair-2 bg-card"
        }`}
      >
        {selected && <CheckIcon />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function AddReinvestmentForm({
  clientId,
  accounts,
  modelPortfolios,
  milestones,
  clientFirstName,
  spouseFirstName,
  initialData,
  onClose,
  onSaved,
  onSubmitDraft,
}: AddReinvestmentFormProps) {
  const writer = useScenarioWriter(clientId);

  // Reinvestments only operate on liquid accounts — exclude business / real estate.
  const liquidAccounts = accounts.filter(
    (a) => !["business", "real_estate"].includes(a.category),
  );

  const [name, setName] = useState(initialData?.name ?? "");
  const [accountIds, setAccountIds] = useState<string[]>(
    initialData?.accountIds ?? [],
  );
  const [year, setYear] = useState(initialData?.year ?? new Date().getFullYear());
  const [yearRef, setYearRef] = useState<YearRef | null>(
    (initialData?.yearRef as YearRef | null) ?? null,
  );
  const [targetType, setTargetType] = useState<"model_portfolio" | "custom">(
    initialData?.targetType ?? "model_portfolio",
  );
  const [modelPortfolioId, setModelPortfolioId] = useState<string>(
    initialData?.modelPortfolioId ?? modelPortfolios[0]?.id ?? "",
  );
  const [customGrowthRate, setCustomGrowthRate] = useState(
    toPercentString(initialData?.customGrowthRate),
  );
  const [pctOrdinary, setPctOrdinary] = useState(
    toPercentString(initialData?.customPctOrdinaryIncome),
  );
  const [pctLtGains, setPctLtGains] = useState(
    toPercentString(initialData?.customPctLtCapitalGains),
  );
  const [pctQualifiedDiv, setPctQualifiedDiv] = useState(
    toPercentString(initialData?.customPctQualifiedDividends),
  );
  const [pctTaxExempt, setPctTaxExempt] = useState(
    toPercentString(initialData?.customPctTaxExempt),
  );
  const [realizeTaxesOnSwitch, setRealizeTaxesOnSwitch] = useState(
    initialData?.realizeTaxesOnSwitch ?? false,
  );

  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>(
    initialData?.groupKeys ?? [],
  );
  const [customGroups, setCustomGroups] = useState<
    { id: string; name: string; memberAccountIds: string[] }[]
  >([]);
  // Auto-name "Reinvestment - {year}" until the user edits the name. Edit mode
  // (existing record) starts "touched" so a saved name is never clobbered.
  const [nameTouched, setNameTouched] = useState<boolean>(Boolean(initialData));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On edit, re-fetch the editable detail fields from the API.
  // ReinvestmentRow is mapped from the framework-free engine type
  // `Reinvestment`, which deliberately carries only the *resolved* growth
  // profile (newGrowthRate/newRealization) — not the raw DB inputs the edit
  // form needs (modelPortfolioId, customGrowthRate, custom realization %s).
  // Those are resolved away at load time; the engine never needs them. Rather
  // than pollute the engine type with DB/UI shape, the form re-fetches them.
  // Draft mode (onSubmitDraft) seeds detail fields from `initialData` directly —
  // the draft isn't in the DB, so a fetch would find nothing and clobber the
  // seeded model with the default. Only the DB-backed edit path needs the fetch.
  useEffect(() => {
    if (!initialData || onSubmitDraft) return;
    const editId = initialData.id;
    let cancelled = false;
    async function loadDetail() {
      try {
        const res = await fetch(`/api/clients/${clientId}/reinvestments`);
        if (!res.ok) return;
        const rows: Array<{
          id: string;
          modelPortfolioId: string | null;
          customGrowthRate: string | null;
          customPctOrdinaryIncome: string | null;
          customPctLtCapitalGains: string | null;
          customPctQualifiedDividends: string | null;
          customPctTaxExempt: string | null;
          groupKeys?: string[];
        }> = await res.json();
        const row = rows.find((r) => r.id === editId);
        if (!row || cancelled) return;
        if (row.modelPortfolioId) setModelPortfolioId(row.modelPortfolioId);
        setCustomGrowthRate(toPercentString(row.customGrowthRate));
        setPctOrdinary(toPercentString(row.customPctOrdinaryIncome));
        setPctLtGains(toPercentString(row.customPctLtCapitalGains));
        setPctQualifiedDiv(toPercentString(row.customPctQualifiedDividends));
        setPctTaxExempt(toPercentString(row.customPctTaxExempt));
        if (Array.isArray(row.groupKeys)) {
          setSelectedGroupKeys(row.groupKeys);
        }
      } catch {
        // Detail fetch failed — the form still works with defaults.
      }
    }
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [clientId, initialData, onSubmitDraft]);

  // Auto-name "Reinvestment - {year}" until the user edits the name.
  useEffect(() => {
    if (!nameTouched) setName(`Reinvestment - ${year}`);
  }, [year, nameTouched]);

  // Fetch custom groups for the combined selector.
  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      try {
        const res = await fetch(`/api/clients/${clientId}/account-groups`);
        if (!res.ok) return;
        const rows: Array<{ id: string; name: string; memberAccountIds: string[] }> =
          await res.json();
        if (!cancelled) setCustomGroups(rows);
      } catch {
        // Selector still works with default groups + individual accounts.
      }
    }
    loadGroups();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  function toggleAccount(accountId: string) {
    setAccountIds((ids) =>
      ids.includes(accountId)
        ? ids.filter((id) => id !== accountId)
        : [...ids, accountId],
    );
  }

  // Live realization-split feedback. When any percent is entered, all four
  // must sum to 100% — surface the running total inline so the user sees the
  // gap before submitting.
  const realizationValues = [pctOrdinary, pctLtGains, pctQualifiedDiv, pctTaxExempt];
  const anyRealizationEntered = realizationValues.some((v) => v !== "");
  const realizationTotal = realizationValues.reduce(
    (sum, v) => sum + (parseFloat(v) || 0),
    0,
  );
  const realizationBalanced = Math.abs(realizationTotal - 100) < 1e-6;

  // Derive group option list + liquid-category map for expand logic. Only
  // truly-liquid categories (isLiquid: taxable/cash/retirement) belong here so
  // custom-group member expansion in the solver-draft preview matches the
  // projection-load path, which strips illiquid members the same way.
  const liquidCategoryById = new Map(
    liquidAccounts
      .filter((a) => isLiquid(a.category as AccountCategory))
      .map((a) => [a.id, a.category as AccountCategory]),
  );
  const customGroupMembersById = new Map(
    customGroups.map((g) => [
      g.id,
      g.memberAccountIds.filter((aid) => liquidCategoryById.has(aid)),
    ]),
  );

  const groupOptions = [
    ...DEFAULT_GROUPS,
    ...customGroups.map((g) => ({ key: g.id, label: g.name })),
  ];

  function toggleGroup(key: string) {
    setSelectedGroupKeys((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // ── Client-side validation ─────────────────────────────────────────────
    if (accountIds.length === 0 && selectedGroupKeys.length === 0) {
      setError("Select at least one account or group.");
      return;
    }
    if (targetType === "model_portfolio" && !modelPortfolioId) {
      setError("Select a model portfolio.");
      return;
    }
    if (targetType === "custom" && !customGrowthRate) {
      setError("Enter a custom growth rate.");
      return;
    }

    // Custom realization split: if any percent is entered, all four must
    // be present and sum to 100%.
    let customRealization:
      | {
          customPctOrdinaryIncome: number;
          customPctLtCapitalGains: number;
          customPctQualifiedDividends: number;
          customPctTaxExempt: number;
        }
      | null = null;

    if (targetType === "custom" && anyRealizationEntered) {
      const nums = realizationValues.map((v) => (parseFloat(v) || 0) / 100);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-6) {
        setError("Realization percentages must sum to 100%.");
        return;
      }
      customRealization = {
        customPctOrdinaryIncome: nums[0],
        customPctLtCapitalGains: nums[1],
        customPctQualifiedDividends: nums[2],
        customPctTaxExempt: nums[3],
      };
    }

    setSubmitting(true);
    try {
      const body = {
        name,
        year,
        yearRef,
        targetType,
        modelPortfolioId: targetType === "model_portfolio" ? modelPortfolioId : null,
        customGrowthRate:
          targetType === "custom" ? (parseFloat(customGrowthRate) || 0) / 100 : null,
        customPctOrdinaryIncome: customRealization?.customPctOrdinaryIncome ?? null,
        customPctLtCapitalGains: customRealization?.customPctLtCapitalGains ?? null,
        customPctQualifiedDividends: customRealization?.customPctQualifiedDividends ?? null,
        customPctTaxExempt: customRealization?.customPctTaxExempt ?? null,
        realizeTaxesOnSwitch,
        accountIds,
        groupKeys: selectedGroupKeys,
      };

      // ── Draft mode ────────────────────────────────────────────────────────
      // When a caller provides `onSubmitDraft`, emit the assembled engine object
      // and skip persistence entirely. `newGrowthRate` and `soldFractionByAccount`
      // are intentional placeholders — the solver server re-resolves them.
      if (onSubmitDraft) {
        const { expandReinvestmentTargets } = await import(
          "@/lib/projection/expand-reinvestment-targets"
        );
        const unionAccountIds = expandReinvestmentTargets(
          body.accountIds,
          selectedGroupKeys,
          {
            accountCategoryById: liquidCategoryById as Map<string, AccountCategory>,
            customGroupMembersById,
          },
        );
        const technique: Reinvestment = {
          id: initialData?.id ?? makeId(),
          name: body.name,
          accountIds: unionAccountIds,
          groupKeys: selectedGroupKeys,
          year: body.year,
          realizeTaxesOnSwitch: body.realizeTaxesOnSwitch,
          newGrowthRate: 0,
          soldFractionByAccount: {},
          targetType: body.targetType,
          ...(body.modelPortfolioId != null ? { modelPortfolioId: body.modelPortfolioId } : {}),
          ...(body.customGrowthRate != null ? { customGrowthRate: body.customGrowthRate } : {}),
          ...(body.customPctOrdinaryIncome != null ? { customPctOrdinaryIncome: body.customPctOrdinaryIncome } : {}),
          ...(body.customPctLtCapitalGains != null ? { customPctLtCapitalGains: body.customPctLtCapitalGains } : {}),
          ...(body.customPctQualifiedDividends != null ? { customPctQualifiedDividends: body.customPctQualifiedDividends } : {}),
          ...(body.customPctTaxExempt != null ? { customPctTaxExempt: body.customPctTaxExempt } : {}),
          ...(body.yearRef != null ? { yearRef: body.yearRef } : {}),
        };
        onSubmitDraft(technique);
        onSaved();
        return;
      }

      const newReinvestmentId = makeId();

      const res = initialData
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "reinvestment",
              targetId: initialData.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/reinvestments`,
              method: "PUT",
              body: { reinvestmentId: initialData.id, ...body },
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "reinvestment",
              entity: { id: newReinvestmentId, ...body },
            },
            {
              url: `/api/clients/${clientId}/reinvestments`,
              method: "POST",
              body,
            },
          );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(
          `Failed to save: ${(err as { error?: string }).error ?? res.statusText}`,
        );
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
      title={initialData ? "Edit Reinvestment" : "Add Reinvestment"}
      size="md"
      primaryAction={{
        label: initialData ? "Save Changes" : "Add Reinvestment",
        form: "reinvestment-form",
        loading: submitting,
        disabled: submitting,
      }}
    >
      <form id="reinvestment-form" onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            {error}
          </p>
        )}

        {/* Row 1 — Name + Year */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="reinvestment-name">
              Name <span className="text-crit">*</span>
            </label>
            <input
              id="reinvestment-name"
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="e.g., Shift to growth portfolio"
              required
              className={inputClassName}
            />
          </div>
          <div>
            {milestones ? (
              <MilestoneYearPicker
                name="year"
                id="reinvestment-year"
                value={year}
                yearRef={yearRef}
                milestones={milestones}
                onChange={(y, r) => {
                  setYear(y);
                  setYearRef(r);
                }}
                label="Year"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName}
                position="start"
              />
            ) : (
              <>
                <label className={fieldLabelClassName} htmlFor="reinvestment-year">
                  Year
                </label>
                <input
                  id="reinvestment-year"
                  type="number"
                  min={2000}
                  max={2100}
                  value={year}
                  onChange={(e) => {
                    setYear(Number(e.target.value));
                    setYearRef(null);
                  }}
                  required
                  className={inputClassName}
                />
              </>
            )}
          </div>
        </div>

        {/* Target type — segmented control */}
        <div>
          <label className={fieldLabelClassName}>Target</label>
          <div className="grid grid-cols-2 gap-2">
            {TARGET_OPTIONS.map((opt) => {
              const active = targetType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTargetType(opt.value)}
                  aria-pressed={active}
                  className={`rounded-[var(--radius-sm)] border-2 px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent/10"
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

        {/* Row — target-specific control + Apply taxes on switch */}
        <div className="grid grid-cols-2 items-start gap-3">
          <div>
            {targetType === "model_portfolio" ? (
              <>
                <label
                  className={fieldLabelClassName}
                  htmlFor="reinvestment-model-portfolio"
                >
                  Model portfolio <span className="text-crit">*</span>
                </label>
                {modelPortfolios.length === 0 ? (
                  <p className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
                    No model portfolios available.
                  </p>
                ) : (
                  <select
                    id="reinvestment-model-portfolio"
                    value={modelPortfolioId}
                    onChange={(e) => setModelPortfolioId(e.target.value)}
                    className={selectClassName}
                  >
                    {modelPortfolios.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.growthRate != null
                          ? `${(p.growthRate * 100).toFixed(2)}% — ${p.name}`
                          : p.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <>
                <label
                  className={fieldLabelClassName}
                  htmlFor="reinvestment-growth-rate"
                >
                  Growth rate (% / yr) <span className="text-crit">*</span>
                </label>
                <PercentInput
                  id="reinvestment-growth-rate"
                  value={customGrowthRate}
                  onChange={(raw) => setCustomGrowthRate(raw)}
                  className={inputClassName}
                />
              </>
            )}
          </div>

          {/* Apply taxes on switch */}
          <div>
            <label className={fieldLabelClassName}>&nbsp;</label>
            <button
              type="button"
              onClick={() => setRealizeTaxesOnSwitch((v) => !v)}
              aria-pressed={realizeTaxesOnSwitch}
              aria-label="Apply taxes on switch"
              className={`flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors ${
                realizeTaxesOnSwitch
                  ? "border-accent/50 bg-accent/10"
                  : "border-hair bg-card-2 hover:border-hair-2"
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                  realizeTaxesOnSwitch
                    ? "border-accent bg-accent text-accent-on"
                    : "border-hair-2 bg-card"
                }`}
              >
                {realizeTaxesOnSwitch && <CheckIcon />}
              </span>
              <span>
                <span className="text-[13px] font-medium text-ink">
                  Apply taxes on switch
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                  Taxable accounts realize gains for the sold portion.
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* Custom realization split — full width */}
        {targetType === "custom" && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-2">
                Realization split <span className="text-ink-4">(optional)</span>
              </span>
              {anyRealizationEntered && (
                <span
                  className={`tabular text-[12px] font-medium ${
                    realizationBalanced ? "text-good" : "text-crit"
                  }`}
                >
                  Total {realizationTotal}%
                </span>
              )}
            </div>
            <p className="-mt-1 mb-2 text-[12px] text-ink-3">
              Leave blank to default to 100% ordinary income. When set, the four
              shares must total 100%.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="reinvestment-pct-ordinary" className="mb-1 block text-[12px] text-ink-3">
                  Ordinary income
                </label>
                <PercentInput id="reinvestment-pct-ordinary" value={pctOrdinary} onChange={(raw) => setPctOrdinary(raw)} className={inputClassName} />
              </div>
              <div>
                <label htmlFor="reinvestment-pct-lt-gains" className="mb-1 block text-[12px] text-ink-3">
                  LT capital gains
                </label>
                <PercentInput id="reinvestment-pct-lt-gains" value={pctLtGains} onChange={(raw) => setPctLtGains(raw)} className={inputClassName} />
              </div>
              <div>
                <label htmlFor="reinvestment-pct-qualified-div" className="mb-1 block text-[12px] text-ink-3">
                  Qualified dividends
                </label>
                <PercentInput id="reinvestment-pct-qualified-div" value={pctQualifiedDiv} onChange={(raw) => setPctQualifiedDiv(raw)} className={inputClassName} />
              </div>
              <div>
                <label htmlFor="reinvestment-pct-tax-exempt" className="mb-1 block text-[12px] text-ink-3">
                  Tax-exempt
                </label>
                <PercentInput id="reinvestment-pct-tax-exempt" value={pctTaxExempt} onChange={(raw) => setPctTaxExempt(raw)} className={inputClassName} />
              </div>
            </div>
          </div>
        )}

        {/* Bottom — combined group + individual-asset selector */}
        <div>
          <label className={fieldLabelClassName}>
            Target accounts <span className="text-crit">*</span>
          </label>
          {liquidAccounts.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink-3">
              No eligible accounts.
            </p>
          ) : (
            <div className="max-h-60 space-y-3 overflow-y-auto pr-0.5">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Groups
                </p>
                {groupOptions.map((g) => (
                  <SelectorButton
                    key={g.key}
                    label={g.label}
                    selected={selectedGroupKeys.includes(g.key)}
                    onToggle={() => toggleGroup(g.key)}
                  />
                ))}
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Individual assets
                </p>
                {liquidAccounts.map((a) => (
                  <SelectorButton
                    key={a.id}
                    label={a.name}
                    selected={accountIds.includes(a.id)}
                    onToggle={() => toggleAccount(a.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
