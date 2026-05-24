"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountOwner } from "@/engine/ownership";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { OwnershipEditor } from "./ownership-editor";
import {
  fieldLabelClassName,
  inputBaseClassName,
  inputClassName,
  selectClassName,
} from "./input-styles";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BusinessTypeValue =
  | "sole_prop"
  | "partnership"
  | "s_corp"
  | "c_corp"
  | "llc"
  | "other";

export type FlowModeValue = "annual" | "schedule";

export type TaxTreatmentValue = "qbi" | "ordinary" | "non_taxable";

export interface AddBusinessFormProps {
  clientId: string;
  entities?: { id: string; name: string }[];
  familyMembers?: {
    id: string;
    role: "client" | "spouse" | "child" | "other";
    firstName: string;
  }[];
  onSuccess?: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_OPTIONS: { value: BusinessTypeValue; label: string }[] = [
  { value: "sole_prop", label: "Sole proprietorship" },
  { value: "llc", label: "LLC" },
  { value: "partnership", label: "Partnership" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "other", label: "Other" },
];

const TAX_TREATMENT_OPTIONS: {
  value: TaxTreatmentValue;
  label: string;
  hint: string;
}[] = [
  {
    value: "qbi",
    label: "QBI (pass-through)",
    hint: "Section 199A — pass-through income eligible for the 20% deduction.",
  },
  {
    value: "ordinary",
    label: "Ordinary income",
    hint: "Pass-through income taxed at ordinary rates with no QBI deduction.",
  },
  {
    value: "non_taxable",
    label: "Non-taxable",
    hint: "Distributions are not taxable to the owner (e.g. return of capital).",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddBusinessForm({
  clientId,
  entities = [],
  familyMembers = [],
  onSuccess,
  onSubmitStateChange,
}: AddBusinessFormProps) {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [nameInvalid, setNameInvalid] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessTypeValue>("llc");
  const [value, setValue] = useState<string>("0");
  const [basis, setBasis] = useState<string>("0");
  const [growthRatePct, setGrowthRatePct] = useState<string>("");

  const [distributionPolicyPct, setDistributionPolicyPct] = useState<string>("");
  const [flowMode, setFlowMode] = useState<FlowModeValue>("annual");
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatmentValue>("qbi");

  const clientFm = useMemo(
    () => familyMembers.find((fm) => fm.role === "client"),
    [familyMembers],
  );
  const defaultOwners: AccountOwner[] = clientFm
    ? [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1 }]
    : [];
  const [owners, setOwners] = useState<AccountOwner[]>(defaultOwners);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  // ── Derived validation ─────────────────────────────────────────────────────
  const valueNum = parseFloat(value) || 0;
  const basisNum = parseFloat(basis) || 0;
  const ownerSum = owners.reduce((s, o) => s + o.percent, 0);
  const ownersSumOk = Math.abs(ownerSum - 1) < 0.0001;
  const ownersAllHaveIds = owners.every((o) =>
    o.kind === "family_member"
      ? !!o.familyMemberId
      : o.kind === "entity"
        ? !!o.entityId
        : false,
  );
  const ownersValid = owners.length > 0 && ownersSumOk && ownersAllHaveIds;

  const canSave =
    name.trim().length > 0 && valueNum >= 0 && basisNum >= 0 && ownersValid;

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: canSave && !loading, loading });
  }, [canSave, loading, onSubmitStateChange]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  function buildBody() {
    const growthRate =
      growthRatePct.trim() === "" ? null : (parseFloat(growthRatePct) || 0) / 100;
    const distributionPolicyPercent =
      distributionPolicyPct.trim() === ""
        ? null
        : (parseFloat(distributionPolicyPct) || 0) / 100;

    return {
      category: "business" as const,
      name: name.trim(),
      businessType,
      value: valueNum,
      basis: basisNum,
      growthRate,
      // Mirrors add-account-form: a user-typed growth rate is "custom"; an
      // empty input means "fall back to the plan/category default".
      growthSource: growthRate === null ? "default" : "custom",
      distributionPolicyPercent,
      flowMode,
      businessTaxTreatment: taxTreatment,
      parentAccountId: null as string | null,
      owners: owners
        .filter((o) => o.kind !== "external_beneficiary")
        .map((o) => ({
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent,
        })),
    };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setNameInvalid(true);
      return;
    }
    if (!canSave) {
      setError("Required fields missing or invalid.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to create business");
        setLoading(false);
        return;
      }
      router.refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const ownerSumPctDisplay = Math.round(ownerSum * 10000) / 100;

  return (
    <form id="add-business-form" onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Section: Basics */}
      <section className="space-y-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Basics
        </h3>

        <div>
          <label htmlFor="biz-name" className={fieldLabelClassName}>
            Name
          </label>
          <input
            id="biz-name"
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameInvalid && e.target.value.trim().length > 0) {
                setNameInvalid(false);
              }
            }}
            className={
              nameInvalid
                ? `${inputBaseClassName} w-full border-red-500`
                : inputClassName
            }
            placeholder="e.g. Smith Family Holdings LLC"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="biz-type" className={fieldLabelClassName}>
              Business type
            </label>
            <select
              id="biz-type"
              value={businessType}
              onChange={(e) =>
                setBusinessType(e.target.value as BusinessTypeValue)
              }
              className={selectClassName}
            >
              {BUSINESS_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="biz-growth" className={fieldLabelClassName}>
              Growth rate
            </label>
            <PercentInput
              id="biz-growth"
              value={growthRatePct}
              onChange={setGrowthRatePct}
              placeholder="(default)"
            />
            <p className="mt-1 text-xs text-ink-4">
              Leave blank to use the plan&apos;s default growth rate for businesses.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="biz-value" className={fieldLabelClassName}>
              Current value
            </label>
            <CurrencyInput
              id="biz-value"
              value={value}
              onChange={setValue}
              className={inputClassName}
            />
          </div>
          <div>
            <label htmlFor="biz-basis" className={fieldLabelClassName}>
              Cost basis
            </label>
            <CurrencyInput
              id="biz-basis"
              value={basis}
              onChange={setBasis}
              className={inputClassName}
            />
          </div>
        </div>
      </section>

      {/* Section: Ownership */}
      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Ownership
        </h3>
        <OwnershipEditor
          familyMembers={familyMembers}
          entities={entities}
          value={owners}
          onChange={setOwners}
          titlingType="jtwros"
          onTitlingTypeChange={() => {}}
          label="Owners"
        />
        <div className="flex items-center gap-3 text-xs">
          <span className="text-ink-4">Sum:</span>
          <span
            className={
              ownersSumOk ? "font-medium text-ink-2" : "font-medium text-red-400"
            }
            aria-live="polite"
          >
            {ownerSumPctDisplay}%
          </span>
          {!ownersSumOk && (
            <span className="text-red-400">
              Owner percentages must sum to 100%.
            </span>
          )}
          {ownersSumOk && !ownersAllHaveIds && (
            <span className="text-red-400">
              Every owner row needs an owner selected.
            </span>
          )}
        </div>
      </section>

      {/* Section: Policy */}
      <section className="space-y-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Distribution & tax policy
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="biz-distpct" className={fieldLabelClassName}>
              Distribution policy
            </label>
            <PercentInput
              id="biz-distpct"
              value={distributionPolicyPct}
              onChange={setDistributionPolicyPct}
              placeholder="(no distribution)"
            />
            <p className="mt-1 text-xs text-ink-4">
              Share of annual earnings paid out to owners. Leave blank for no
              distribution.
            </p>
          </div>
          <div>
            <label htmlFor="biz-flowmode" className={fieldLabelClassName}>
              Distribution mode
            </label>
            <select
              id="biz-flowmode"
              value={flowMode}
              onChange={(e) => setFlowMode(e.target.value as FlowModeValue)}
              className={selectClassName}
            >
              <option value="annual">Annual (use distribution policy %)</option>
              <option value="schedule">Schedule (per-year overrides)</option>
            </select>
            {flowMode === "schedule" && (
              <p className="mt-1 text-xs text-ink-4">
                Per-year schedule editor coming in a later phase. For now, the
                engine treats this as zero.
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="biz-tax" className={fieldLabelClassName}>
            Tax treatment
          </label>
          <select
            id="biz-tax"
            value={taxTreatment}
            onChange={(e) =>
              setTaxTreatment(e.target.value as TaxTreatmentValue)
            }
            className={selectClassName}
          >
            {TAX_TREATMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-4">
            {TAX_TREATMENT_OPTIONS.find((o) => o.value === taxTreatment)?.hint}
          </p>
        </div>
      </section>
    </form>
  );
}
