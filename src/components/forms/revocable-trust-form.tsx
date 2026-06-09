// src/components/forms/revocable-trust-form.tsx
"use client";

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import type { Designation, Entity, ExternalBeneficiary, FamilyMember } from "../family-view";
import BeneficiaryRowList, { type BeneficiaryRow } from "./beneficiary-row-list";
import { designationsToRows, rowsToDesignationPayload } from "./add-trust-form";
import AssetsTab, {
  type AssetsTabAccount, type AssetsTabLiability, type AssetsTabIncome,
  type AssetsTabExpense, type AssetsTabFamilyMember,
} from "./assets-tab";
import { applyAssetTabOp } from "./asset-tab-ops";
import type { AssetTabOp } from "./asset-tab-ops";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import type { AccountOwner } from "@/engine/ownership";
import type { SaveResult } from "@/lib/use-tab-auto-save";
import { buildRevocableEntityBody } from "./revocable-trust-entity-body";

export interface RevocableTrustFormHandle {
  saveAsync: () => Promise<SaveResult & { recordId?: string; entity?: Entity }>;
}

interface RevocableTrustFormProps {
  clientId: string;
  editing?: Entity;
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  /** Other entities for the remainder picker (excludes self). */
  otherEntities: { id: string; name: string }[];
  initialDesignations?: Designation[];
  activeTab: "details" | "assets";
  accounts?: AssetsTabAccount[];
  liabilities?: AssetsTabLiability[];
  incomes?: AssetsTabIncome[];
  expenses?: AssetsTabExpense[];
  assetFamilyMembers?: AssetsTabFamilyMember[];
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onClose: () => void;
  onSubmitStateChange?: (s: { canSubmit: boolean; loading: boolean }) => void;
  onAutoSaveStateChange?: (s: { isDirty: boolean; canSave: boolean }) => void;
  onAutoSaved?: (entity: Entity, mode: "create" | "edit") => void;
}

const RevocableTrustForm = forwardRef<RevocableTrustFormHandle, RevocableTrustFormProps>(
  function RevocableTrustForm({
    clientId, editing, household, members, externals, otherEntities,
    initialDesignations, activeTab, accounts, liabilities, incomes, expenses,
    assetFamilyMembers, onSaved, onClose, onSubmitStateChange,
    onAutoSaveStateChange, onAutoSaved,
  }, ref) {
    const isCreate = !editing;
    const scenarioWriter = useScenarioWriter(clientId);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [effectiveEntityId, setEffectiveEntityId] = useState<string | null>(editing?.id ?? null);

    const [name, setName] = useState(editing?.name ?? "Revocable Trust");
    const [grantor, setGrantor] = useState<"client" | "spouse">(
      editing?.grantor === "spouse" ? "spouse" : "client",
    );

    // Auto-focus + select the name on create so the placeholder is easy to replace.
    const nameInputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (!isCreate) return;
      const el = nameInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, [isCreate]);

    // Remainder beneficiaries only — no income tier for revocable trusts.
    const scopedDesignations = useMemo(
      () => (editing ? (initialDesignations ?? []).filter((d) => d.entityId === editing.id) : []),
      [editing, initialDesignations],
    );
    const [remainderRows, setRemainderRows] = useState<BeneficiaryRow[]>(
      () => designationsToRows(scopedDesignations, "remainder"),
    );

    // Dirty tracking — drives useTabAutoSave in the parent dialog.
    const currentSerialized = useMemo(
      () => JSON.stringify({ name, grantor, remainderRows }),
      [name, grantor, remainderRows],
    );
    const baselineRef = useRef<string>("");
    useEffect(() => {
      baselineRef.current = currentSerialized;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const isDirty = currentSerialized !== baselineRef.current;
    const canSave = name.trim().length > 0;

    useEffect(() => onSubmitStateChange?.({ canSubmit: !loading, loading }), [loading, onSubmitStateChange]);
    // onAutoSaveStateChange / onSubmitStateChange must be stable refs (a setState
    // setter or useCallback) — an inline arrow would change identity each render
    // and re-fire these effects in a loop. The dialog passes setState setters.
    useEffect(() => onAutoSaveStateChange?.({ isDirty, canSave }), [isDirty, canSave, onAutoSaveStateChange]);

    const assetEntityId = effectiveEntityId ?? editing?.id ?? null;

    // Account/liability ownership assignment. Mirrors the account/liability
    // branch of add-trust-form's handleAssetTabOp; the business-entity branch is
    // intentionally omitted (revocable trusts don't surface the business picker).
    const handleAssetTabOp = useCallback(async (op: AssetTabOp) => {
      if (!assetEntityId) return;
      if (op.assetType === "entity") return; // businesses not offered for revocable trusts

      const ctx = {
        entityId: assetEntityId,
        familyMembers: (assetFamilyMembers ?? []).map((m) => ({ id: m.id, role: m.role })),
      };
      const currentItem =
        op.assetType === "account"
          ? (accounts ?? []).find((a) => a.id === op.assetId)
          : (liabilities ?? []).find((l) => l.id === op.assetId);
      if (!currentItem && op.type !== "add") return;
      const currentOwners = currentItem?.owners ?? [];

      let newOwners: AccountOwner[];
      try {
        newOwners = applyAssetTabOp(currentOwners, op, ctx);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Cannot apply this change");
        return;
      }

      const url =
        op.assetType === "account"
          ? `/api/clients/${clientId}/accounts/${op.assetId}`
          : `/api/clients/${clientId}/liabilities/${op.assetId}`;
      try {
        const res = await scenarioWriter.submit(
          { op: "edit", targetKind: op.assetType, targetId: op.assetId, desiredFields: { owners: newOwners } },
          { url, method: "PUT", body: { owners: newOwners } },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "Failed to update asset ownership");
        }
        // useScenarioWriter calls router.refresh() on success.
      } catch {
        setError("Failed to update asset ownership");
      }
    }, [assetEntityId, accounts, liabilities, assetFamilyMembers, clientId, scenarioWriter]);

    const saveAsyncImpl = useCallback(async (): Promise<SaveResult & { recordId?: string; entity?: Entity }> => {
      if (!canSave) return { ok: false, error: "Please name the trust before saving." };

      const targetId = effectiveEntityId ?? editing?.id ?? null;
      // Creating a trust inside a scenario isn't supported (mirrors add-trust-form).
      if (scenarioWriter.scenarioActive && targetId == null) {
        return {
          ok: false,
          error: "Creating a trust isn't supported inside a scenario yet — create it in the base plan, then adjust it here.",
        };
      }

      setLoading(true);
      setError(null);
      try {
        const entityBody = buildRevocableEntityBody({
          name,
          grantor,
          notes: editing?.notes ?? null, // no notes field in this dialog; echo back any note set elsewhere
        });

        const url = targetId
          ? `/api/clients/${clientId}/entities/${targetId}`
          : `/api/clients/${clientId}/entities`;
        // Scenario edits overlay only scalar trust fields (engine derives the rest).
        const scenarioOmit = new Set(["owner", "beneficiaries", "value", "entityType"]);
        const scenarioEntityFields = Object.fromEntries(
          Object.entries(entityBody).filter(([k]) => !scenarioOmit.has(k)),
        );
        const res = targetId
          ? await scenarioWriter.submit(
              { op: "edit", targetKind: "entity", targetId, desiredFields: scenarioEntityFields },
              { url, method: "PUT", body: entityBody },
            )
          : await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entityBody),
            });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: j.error ?? "Failed to save" };
        }
        const saved: Entity = scenarioWriter.scenarioActive
          ? ({ ...editing, ...entityBody, id: targetId! } as unknown as Entity)
          : ((await res.json()) as Entity);

        // Remainder beneficiaries (no income tier). Skipped in scenario mode —
        // beneficiary_designations have no scenario-overlay path (mirrors add-trust-form).
        if (!scenarioWriter.scenarioActive) {
          const designations = rowsToDesignationPayload(remainderRows, "remainder");
          const desigRes = await fetch(`/api/clients/${clientId}/entities/${saved.id}/beneficiaries`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(designations),
          });
          if (!desigRes.ok) {
            const j = (await desigRes.json().catch(() => ({}))) as { error?: string };
            return { ok: false, error: j.error ?? "Failed to save beneficiaries" };
          }
        }

        const wasFirstCreate = !effectiveEntityId && !editing;
        if (wasFirstCreate) setEffectiveEntityId(saved.id);
        baselineRef.current = currentSerialized;
        onAutoSaved?.(saved, wasFirstCreate ? "create" : "edit");
        return { ok: true, recordId: saved.id, entity: saved };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      } finally {
        setLoading(false);
      }
    }, [
      canSave, effectiveEntityId, editing, scenarioWriter, name, grantor,
      clientId, remainderRows, currentSerialized, onAutoSaved,
    ]);

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault();
      // Snapshot wasFirstCreate before saveAsyncImpl, which flips effectiveEntityId.
      const wasFirstCreate = !effectiveEntityId && !editing;
      const result = await saveAsyncImpl();
      if (!result.ok) { setError(result.error); return; }
      if (result.entity) onSaved(result.entity, wasFirstCreate ? "create" : "edit");
      onClose();
    }

    useImperativeHandle(ref, () => ({ saveAsync: saveAsyncImpl }), [saveAsyncImpl]);

    return (
      <form id="revocable-trust-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

        <div className={activeTab !== "details" ? "hidden" : ""}>
          {/* Name */}
          <div>
            <label className={fieldLabelClassName} htmlFor="rev-trust-name">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="rev-trust-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Smith Living Trust"
              className={inputClassName}
            />
          </div>

          {/* Grantor — Client/Spouse only (a revocable trust needs a household
              grantor to be pulled into the estate). */}
          <div className="mt-4 max-w-[260px]">
            <label className={fieldLabelClassName} htmlFor="rev-trust-grantor">
              Grantor <span className="text-red-500">*</span>
            </label>
            <select
              id="rev-trust-grantor"
              value={grantor}
              onChange={(e) => setGrantor(e.target.value as "client" | "spouse")}
              className={selectClassName}
            >
              <option value="client">{household.client.firstName} (client)</option>
              {household.spouse && <option value="spouse">{household.spouse.firstName} (spouse)</option>}
            </select>
          </div>

          {/* Remainder beneficiaries */}
          <div className="mt-4">
            <BeneficiaryRowList
              tier="remainder"
              allowEntities={true}
              rows={remainderRows}
              onChange={setRemainderRows}
              members={members}
              externals={externals}
              entities={otherEntities.filter((e) => e.id !== editing?.id)}
              household={household}
            />
          </div>
        </div>

        <div className={activeTab !== "assets" ? "hidden" : ""}>
          {assetEntityId && accounts !== undefined ? (
            <AssetsTab
              entityId={assetEntityId}
              accounts={accounts ?? []}
              liabilities={liabilities ?? []}
              incomes={incomes ?? []}
              expenses={expenses ?? []}
              familyMembers={assetFamilyMembers ?? []}
              entities={otherEntities.filter((e) => e.id !== editing?.id)}
              entityLabel="trust"
              onChange={handleAssetTabOp}
            />
          ) : (
            <p className="text-[13px] text-ink-3 text-center py-6">
              Add a name on the Details tab — the trust saves automatically, then you can assign assets here.
            </p>
          )}
        </div>
      </form>
    );
  },
);

export default RevocableTrustForm;
