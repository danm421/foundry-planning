"use client";

import { useEffect, useState } from "react";
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
import type { Designation, Entity, ExternalBeneficiary, FamilyMember } from "../family-view";
import BeneficiaryRowList, { type BeneficiaryRow } from "./beneficiary-row-list";
import TrustEndsSelect, { type TrustEnds } from "./trust-ends-select";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";
import { inputClassName, selectClassName, textareaClassName, fieldLabelClassName } from "./input-styles";

interface AddTrustFormProps {
  clientId: string;
  editing?: Entity;
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: { id: string; name: string }[];  // for remainder picker
  initialDesignations?: Designation[];        // pre-loaded for edit mode
  activeTab: "details" | "notes";
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onClose: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
}

const TRUST_TYPE_LABELS: Record<TrustSubType, string> = {
  revocable: "Revocable",
  irrevocable: "Irrevocable (generic)",
  ilit: "ILIT",
  slat: "SLAT",
  crt: "CRT",
  grat: "GRAT",
  qprt: "QPRT",
  clat: "CLAT",
  qtip: "QTIP",
  bypass: "Bypass / Credit Shelter",
};

export default function AddTrustForm({
  clientId, editing, household, members, externals, entities,
  initialDesignations, activeTab, onSaved, onClose, onSubmitStateChange,
}: AddTrustFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onSubmitStateChange?.({ canSubmit: !loading, loading }), [loading, onSubmitStateChange]);

  // Form state
  const [name, setName] = useState(editing?.name ?? "");
  const [trustSubType, setTrustSubType] = useState<TrustSubType | "">(editing?.trustSubType ?? "");
  const [trustee, setTrustee] = useState(editing?.trustee ?? "");
  const [grantor, setGrantor] = useState<"client" | "spouse" | "">(editing?.grantor ?? "");
  const [trustEnds, setTrustEnds] = useState<TrustEnds | null>((editing as Entity & { trustEnds?: TrustEnds | null })?.trustEnds ?? null);
  const [includeInPortfolio, setIncludeInPortfolio] = useState(editing?.includeInPortfolio ?? false);
  const [isGrantor, setIsGrantor] = useState(editing?.isGrantor ?? false);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  // Distribution policy
  const [distributionMode, setDistributionMode] = useState<"fixed" | "pct_liquid" | "pct_income" | null>(editing?.distributionMode ?? null);
  const [distributionAmount, setDistributionAmount] = useState(editing?.distributionAmount != null ? String(editing.distributionAmount) : "");
  const [distributionPercent, setDistributionPercent] = useState(() => {
    const raw = editing?.distributionPercent;
    return raw != null ? (Number(raw) * 100).toFixed(2) : "";
  });

  // Beneficiary rows — built from initialDesignations
  const [incomeRows, setIncomeRows] = useState<BeneficiaryRow[]>(() => designationsToRows(initialDesignations ?? [], "income"));
  const [remainderRows, setRemainderRows] = useState<BeneficiaryRow[]>(() => designationsToRows(initialDesignations ?? [], "remainder"));

  const isIrrevocable = trustSubType !== "" && deriveIsIrrevocable(trustSubType);
  const showDistributionAndIncome = isIrrevocable;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (trustSubType === "") {
      setError("Please pick a type.");
      return;
    }
    // Inline validation: distribution mode set ⇒ ≥1 income beneficiary
    if (distributionMode != null && incomeRows.filter((r) => r.source.kind !== "empty").length === 0) {
      setError("Distribution mode is set but no income beneficiaries are listed.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Save entity row first
      const entityBody = {
        name,
        entityType: "trust",
        notes: notes || null,
        includeInPortfolio,
        isGrantor,
        value: "0",
        owner: null,
        grantor: grantor || null,
        beneficiaries: [],  // legacy JSON column kept empty
        trustSubType: trustSubType as TrustSubType,
        isIrrevocable,
        trustee: trustee.trim() || null,
        trustEnds,
        distributionMode: showDistributionAndIncome ? distributionMode : null,
        distributionAmount: showDistributionAndIncome && distributionMode === "fixed" && distributionAmount.trim() !== "" ? Number(distributionAmount) : null,
        distributionPercent: showDistributionAndIncome && (distributionMode === "pct_liquid" || distributionMode === "pct_income") && distributionPercent.trim() !== "" ? Number(distributionPercent) / 100 : null,
      };
      const isEdit = Boolean(editing);
      const url = isEdit ? `/api/clients/${clientId}/entities/${editing!.id}` : `/api/clients/${clientId}/entities`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entityBody),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      const saved = (await res.json()) as Entity;

      // Save designations (income + remainder)
      const designations = [
        ...rowsToDesignationPayload(incomeRows, "income"),
        ...rowsToDesignationPayload(remainderRows, "remainder"),
      ];
      const desigRes = await fetch(`/api/clients/${clientId}/entities/${saved.id}/beneficiaries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(designations),
      });
      if (!desigRes.ok) throw new Error((await desigRes.json()).error ?? "Failed to save beneficiaries");

      onSaved(saved, isEdit ? "edit" : "create");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="add-trust-form" onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className={activeTab !== "details" ? "hidden" : ""}>
        {/* Name */}
        <div>
          <label className={fieldLabelClassName} htmlFor="trust-name">Name <span className="text-red-500">*</span></label>
          <input id="trust-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Smith Family Trust" className={inputClassName} />
        </div>

        {/* Type + Trustee */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="trust-type">Type <span className="text-red-500">*</span></label>
            <select id="trust-type" required value={trustSubType} onChange={(e) => setTrustSubType(e.target.value as TrustSubType | "")} className={selectClassName}>
              <option value="" disabled>— select type —</option>
              {Object.entries(TRUST_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="trust-trustee">Trustee</label>
            <input id="trust-trustee" type="text" value={trustee} onChange={(e) => setTrustee(e.target.value)} placeholder="e.g., Linda, or Fidelity Trust Co." className={inputClassName} />
          </div>
        </div>

        {/* Grantor + Trust Ends */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="trust-grantor">Grantor</label>
            <select id="trust-grantor" value={grantor} onChange={(e) => setGrantor(e.target.value as "client" | "spouse" | "")} className={selectClassName}>
              <option value="">Third party (none)</option>
              <option value="client">Client</option>
              <option value="spouse">Spouse</option>
            </select>
          </div>
          <div>
            <TrustEndsSelect household={household} value={trustEnds} onChange={setTrustEnds} id="trust-ends" />
          </div>
        </div>

        {/* Income Beneficiaries (hidden for revocable) */}
        {showDistributionAndIncome && (
          <div className="mt-4">
            <BeneficiaryRowList
              tier="income"
              allowEntities={false}
              rows={incomeRows}
              onChange={setIncomeRows}
              members={members}
              externals={externals}
              entities={[]}
              household={household}
            />
          </div>
        )}

        {/* Remainder Beneficiaries (always shown) */}
        <div className="mt-4">
          <BeneficiaryRowList
            tier="remainder"
            allowEntities={true}
            rows={remainderRows}
            onChange={setRemainderRows}
            members={members}
            externals={externals}
            entities={entities.filter((e) => e.id !== editing?.id)}
            household={household}
          />
        </div>

        {/* Distribution Policy (hidden for revocable) */}
        {showDistributionAndIncome && (
          <div className="mt-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Distribution Policy
              </span>
              <div className="flex gap-1 text-xs">
                {([
                  ["none", "None"],
                  ["fixed", "Fixed $"],
                  ["pct_liquid", "% liquid"],
                  ["pct_income", "% income"],
                ] as const).map(([val, label]) => {
                  const active = val === "none" ? distributionMode === null : distributionMode === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDistributionMode(val === "none" ? null : val)}
                      className={
                        "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
                        (active
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-hair bg-card text-ink-3 hover:border-hair-2 hover:text-ink-2")
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {distributionMode === "fixed" && (
              <div>
                <label className={fieldLabelClassName} htmlFor="dist-amount">Annual amount</label>
                <CurrencyInput id="dist-amount" value={distributionAmount} onChange={setDistributionAmount} />
              </div>
            )}
            {(distributionMode === "pct_liquid" || distributionMode === "pct_income") && (
              <div>
                <label className={fieldLabelClassName} htmlFor="dist-percent">Annual percent</label>
                <PercentInput id="dist-percent" value={distributionPercent} onChange={setDistributionPercent} />
              </div>
            )}
          </div>
        )}

        {/* Toggles */}
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 cursor-pointer hover:border-hair-2">
            <input
              type="checkbox"
              checked={includeInPortfolio}
              onChange={(e) => setIncludeInPortfolio(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-hair bg-card text-accent focus:ring-1 focus:ring-accent/40"
            />
            <span className="text-sm text-ink-2">
              Include this entity&apos;s accounts in portfolio assets
              <span className="block text-xs text-ink-4">
                Trust-owned accounts contribute to liquid assets and projected returns.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 cursor-pointer hover:border-hair-2">
            <input
              type="checkbox"
              checked={isGrantor}
              onChange={(e) => setIsGrantor(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-hair bg-card text-accent focus:ring-1 focus:ring-accent/40"
            />
            <span className="text-sm text-ink-2">
              Income taxes paid by household (grantor trust)
              <span className="block text-xs text-ink-4">
                Trust income flows to the grantor&apos;s 1040 — household pays tax instead of the trust.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className={activeTab !== "notes" ? "hidden" : ""}>
        <label className={fieldLabelClassName} htmlFor="trust-notes">Notes</label>
        <textarea id="trust-notes" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClassName} />
      </div>
    </form>
  );
}

function designationsToRows(d: Designation[], tier: "income" | "remainder"): BeneficiaryRow[] {
  return d
    .filter((x) => x.tier === tier)
    .map((x) => ({
      id: x.id,
      source: designationToSource(x),
      percentage: x.percentage,
    }));
}

function designationToSource(d: Designation): BeneficiaryRow["source"] {
  if (d.familyMemberId) return { kind: "family", familyMemberId: d.familyMemberId };
  if (d.externalBeneficiaryId) return { kind: "external", externalBeneficiaryId: d.externalBeneficiaryId };
  if (d.entityIdRef) return { kind: "entity", entityId: d.entityIdRef };
  if (d.householdRole) return { kind: "household", role: d.householdRole };
  return { kind: "empty" };
}

function rowsToDesignationPayload(rows: BeneficiaryRow[], tier: "income" | "remainder") {
  return rows
    .filter((r) => r.source.kind !== "empty")
    .map((r, idx) => {
      const base = { tier, percentage: r.percentage, sortOrder: idx };
      switch (r.source.kind) {
        case "household": return { ...base, householdRole: r.source.role };
        case "family": return { ...base, familyMemberId: r.source.familyMemberId };
        case "external": return { ...base, externalBeneficiaryId: r.source.externalBeneficiaryId };
        case "entity": return { ...base, entityIdRef: r.source.entityId };
        default: return base;
      }
    });
}
