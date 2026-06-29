"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { AccountOwner } from "@/engine/ownership";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { OwnershipEditor } from "@/components/forms/ownership-editor";
import {
  fieldLabelClassName,
  inputBaseClassName,
  inputClassName,
  selectClassName,
} from "@/components/forms/input-styles";
import type { BusinessAccount, BusinessFormAutoSaveHandle, BusinessTab } from "./types";

type BusinessTypeValue = "sole_prop" | "partnership" | "s_corp" | "c_corp" | "llc" | "other";
type TaxTreatmentValue = "qbi" | "ordinary" | "non_taxable";

const BUSINESS_TYPE_OPTIONS: { value: BusinessTypeValue; label: string }[] = [
  { value: "sole_prop", label: "Sole proprietorship" },
  { value: "llc", label: "LLC" },
  { value: "partnership", label: "Partnership" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "other", label: "Other" },
];

const TAX_TREATMENT_OPTIONS: { value: TaxTreatmentValue; label: string; hint: string }[] = [
  { value: "qbi", label: "QBI (pass-through)", hint: "Section 199A — pass-through income eligible for the 20% deduction." },
  { value: "ordinary", label: "Ordinary income", hint: "Pass-through income taxed at ordinary rates with no QBI deduction." },
  { value: "non_taxable", label: "Non-taxable", hint: "Distributions are not taxable to the owner (e.g. return of capital)." },
];

export interface BusinessDetailsFormProps {
  clientId: string;
  editing?: BusinessAccount;
  activeTab: BusinessTab;
  familyMembers: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  entities: { id: string; name: string }[];
  onSaved: (business: BusinessAccount, mode: "create" | "edit") => void;
  onAutoSaved?: (business: BusinessAccount, mode: "create" | "edit") => void;
  onClose: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  onAutoSaveStateChange?: (state: { isDirty: boolean; canSave: boolean }) => void;
}

function defaultOwners(members: BusinessDetailsFormProps["familyMembers"]): AccountOwner[] {
  const client = members.find((m) => m.role === "client");
  if (client) return [{ kind: "family_member", familyMemberId: client.id, percent: 1 }];
  return [];
}

const BusinessDetailsForm = forwardRef<BusinessFormAutoSaveHandle, BusinessDetailsFormProps>(
  function BusinessDetailsForm(
    {
      clientId,
      editing,
      activeTab,
      familyMembers,
      entities,
      onSaved,
      onAutoSaved,
      onClose,
      onSubmitStateChange,
      onAutoSaveStateChange,
    },
    ref,
  ) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [name, setName] = useState<string>(editing?.name ?? "");
    const [nameInvalid, setNameInvalid] = useState(false);
    const [businessType, setBusinessType] = useState<BusinessTypeValue>(
      (editing?.businessType as BusinessTypeValue | undefined) ?? "llc",
    );
    const [value, setValue] = useState<string>(editing ? String(editing.value ?? 0) : "0");
    const [basis, setBasis] = useState<string>(editing ? String(editing.basis ?? 0) : "0");
    const [growthRatePct, setGrowthRatePct] = useState<string>(
      editing?.growthRate != null
        ? String(Number((editing.growthRate * 100).toFixed(4)))
        : "",
    );
    const [distributionPolicyPct, setDistributionPolicyPct] = useState<string>(
      editing?.distributionPolicyPercent != null
        ? String(Number((editing.distributionPolicyPercent * 100).toFixed(4)))
        : "",
    );
    const [taxTreatment, setTaxTreatment] = useState<TaxTreatmentValue>(
      (editing?.businessTaxTreatment as TaxTreatmentValue | undefined) ?? "qbi",
    );
    const [owners, setOwners] = useState<AccountOwner[]>(
      editing?.owners && editing.owners.length > 0 ? editing.owners : defaultOwners(familyMembers),
    );
    const [effectiveId, setEffectiveId] = useState<string | null>(editing?.id ?? null);

    const nameInputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (!editing) {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }
    }, [editing]);

    const valueNum = parseFloat(value) || 0;
    const basisNum = parseFloat(basis) || 0;
    const ownerSum = owners.reduce((s, o) => s + o.percent, 0);
    const ownersSumOk = Math.abs(ownerSum - 1) < 0.0001;
    const ownersAllHaveIds = owners.every((o) =>
      o.kind === "family_member" ? !!o.familyMemberId : o.kind === "entity" ? !!o.entityId : false,
    );
    const ownersValid = owners.length > 0 && ownersSumOk && ownersAllHaveIds;
    const canSave = name.trim().length > 0 && valueNum >= 0 && basisNum >= 0 && ownersValid;

    useEffect(() => {
      onSubmitStateChange?.({ canSubmit: canSave && !loading, loading });
    }, [canSave, loading, onSubmitStateChange]);

    const currentSerialized = useMemo(
      () =>
        JSON.stringify({
          name, businessType, value, basis, growthRatePct, distributionPolicyPct,
          taxTreatment, owners,
        }),
      [name, businessType, value, basis, growthRatePct, distributionPolicyPct, taxTreatment, owners],
    );
    const baselineRef = useRef<string>("");
    useEffect(() => {
      baselineRef.current = currentSerialized;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const isDirty = currentSerialized !== baselineRef.current;
    useEffect(() => {
      onAutoSaveStateChange?.({ isDirty, canSave });
    }, [isDirty, canSave, onAutoSaveStateChange]);

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
        growthSource: growthRate === null ? "default" : "custom",
        distributionPolicyPercent,
        businessTaxTreatment: taxTreatment,
        parentAccountId: editing?.parentAccountId ?? null,
        owners: owners
          .filter((o) => o.kind !== "external_beneficiary" && o.kind !== "gifted_away")
          .map((o) =>
            o.kind === "family_member"
              ? { kind: "family_member", familyMemberId: o.familyMemberId, percent: o.percent }
              : { kind: "entity", entityId: o.entityId, percent: o.percent },
          ),
      };
    }

    const saveAsyncImpl = useCallback(async () => {
      if (!canSave) return { ok: false as const, error: "Please complete required fields." };
      setLoading(true);
      setError(null);
      try {
        const targetId = effectiveId;
        const url = targetId
          ? `/api/clients/${clientId}/accounts/${targetId}`
          : `/api/clients/${clientId}/accounts`;
        const res = await fetch(url, {
          method: targetId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildBody()),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          const msg = json.error ?? "Failed to save business";
          setError(msg);
          return { ok: false as const, error: msg };
        }
        const saved = (await res.json()) as BusinessAccount;
        const wasFirstCreate = !effectiveId;
        if (wasFirstCreate) setEffectiveId(saved.id);
        baselineRef.current = currentSerialized;
        onAutoSaved?.(saved, wasFirstCreate ? "create" : "edit");
        router.refresh();
        return { ok: true as const, recordId: saved.id, account: saved };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        return { ok: false as const, error: msg };
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canSave, effectiveId, clientId, currentSerialized, router, onAutoSaved]);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      if (name.trim().length === 0) {
        setNameInvalid(true);
        return;
      }
      const wasFirstCreate = !effectiveId;
      const result = await saveAsyncImpl();
      if (!result.ok) return;
      onSaved(result.account!, wasFirstCreate ? "create" : "edit");
      onClose();
    }

    useImperativeHandle(ref, () => ({ saveAsync: saveAsyncImpl }), [saveAsyncImpl]);

    const ownerSumPctDisplay = Math.round(ownerSum * 10000) / 100;

    return (
      <form
        id="business-details-form"
        onSubmit={handleSubmit}
        className={activeTab !== "details" ? "hidden" : "space-y-6"}
      >
        {error && (
          <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        {/* Section: Basics */}
        <section className="space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Basics</h3>

          <div>
            <label htmlFor="biz-name" className={fieldLabelClassName}>Name</label>
            <input
              id="biz-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameInvalid && e.target.value.trim().length > 0) setNameInvalid(false);
              }}
              className={
                nameInvalid ? `${inputBaseClassName} w-full border-red-500` : inputClassName
              }
              placeholder="e.g. Smith Family Holdings LLC"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="biz-type" className={fieldLabelClassName}>Business type</label>
              <select
                id="biz-type"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as BusinessTypeValue)}
                className={selectClassName}
              >
                {BUSINESS_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="biz-growth" className={fieldLabelClassName}>Growth rate</label>
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
              <label htmlFor="biz-value" className={fieldLabelClassName}>Current value</label>
              <CurrencyInput id="biz-value" value={value} onChange={setValue} className={inputClassName} />
            </div>
            <div>
              <label htmlFor="biz-basis" className={fieldLabelClassName}>Cost basis</label>
              <CurrencyInput id="biz-basis" value={basis} onChange={setBasis} className={inputClassName} />
            </div>
          </div>
        </section>

        {/* Section: Ownership */}
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Ownership</h3>
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
              className={ownersSumOk ? "font-medium text-ink-2" : "font-medium text-red-400"}
              aria-live="polite"
            >
              {ownerSumPctDisplay}%
            </span>
            {!ownersSumOk && <span className="text-red-400">Owner percentages must sum to 100%.</span>}
            {ownersSumOk && !ownersAllHaveIds && (
              <span className="text-red-400">Every owner row needs an owner selected.</span>
            )}
          </div>
        </section>

        {/* Section: Policy */}
        <section className="space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            Distribution &amp; tax policy
          </h3>

          <div>
            <label htmlFor="biz-distpct" className={fieldLabelClassName}>Distribution policy</label>
            <PercentInput
              id="biz-distpct"
              value={distributionPolicyPct}
              onChange={setDistributionPolicyPct}
              placeholder="(no distribution)"
            />
            <p className="mt-1 text-xs text-ink-4">
              Share of annual earnings paid out to owners. Leave blank for no distribution.
            </p>
          </div>

          <div>
            <label htmlFor="biz-tax" className={fieldLabelClassName}>Tax treatment</label>
            <select
              id="biz-tax"
              value={taxTreatment}
              onChange={(e) => setTaxTreatment(e.target.value as TaxTreatmentValue)}
              className={selectClassName}
            >
              {TAX_TREATMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-4">
              {TAX_TREATMENT_OPTIONS.find((o) => o.value === taxTreatment)?.hint}
            </p>
          </div>
        </section>
      </form>
    );
  },
);

export default BusinessDetailsForm;
