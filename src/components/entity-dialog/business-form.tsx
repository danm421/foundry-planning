"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import type { Entity } from "../family-view";
import type { EntityFormCommonProps } from "./types";
import { selectClassName, fieldLabelClassName, inputClassName, textareaClassName } from "../forms/input-styles";
import { CurrencyInput } from "../currency-input";
import { OwnershipEditor } from "../forms/ownership-editor";
import type { AccountOwner } from "@/engine/ownership";
import AssetsTab, {
  type AssetsTabAccount,
  type AssetsTabLiability,
  type AssetsTabIncome,
  type AssetsTabExpense,
  type AssetsTabFamilyMember,
} from "../forms/assets-tab";
import { applyAssetTabOp, type AssetTabOp } from "../forms/asset-tab-ops";

type BusinessEntityType = "llc" | "s_corp" | "c_corp" | "partnership" | "other";

const BUSINESS_ENTITY_TYPE_LABELS: Record<BusinessEntityType, string> = {
  llc: "LLC",
  s_corp: "S Corp",
  c_corp: "C Corp",
  partnership: "Partnership",
  other: "Other",
};

interface BusinessFormProps extends EntityFormCommonProps {
  activeTab: "details" | "flows" | "assets" | "notes";
  accounts?: AssetsTabAccount[];
  liabilities?: AssetsTabLiability[];
  incomes?: AssetsTabIncome[];
  expenses?: AssetsTabExpense[];
  assetFamilyMembers?: AssetsTabFamilyMember[];
  otherEntities?: { id: string; name: string }[];
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
}

function defaultOwners(members: AssetsTabFamilyMember[]): AccountOwner[] {
  const client = members.find((m) => m.role === "client");
  if (client) return [{ kind: "family_member", familyMemberId: client.id, percent: 1 }];
  return [];
}

export default function BusinessForm({
  clientId,
  editing,
  onSaved,
  onClose,
  activeTab,
  accounts,
  liabilities,
  incomes,
  expenses,
  assetFamilyMembers,
  otherEntities,
  onSubmitStateChange,
}: BusinessFormProps) {
  const writer = useScenarioWriter(clientId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading, loading });
  }, [loading, onSubmitStateChange]);

  const familyMembers = useMemo(() => assetFamilyMembers ?? [], [assetFamilyMembers]);

  const [entityType, setEntityType] = useState<BusinessEntityType>(
    (editing?.entityType as BusinessEntityType | undefined) ?? "llc",
  );
  const [name, setName] = useState<string>(editing?.name ?? "");
  const [includeInPortfolio, setIncludeInPortfolio] = useState<boolean>(editing?.includeInPortfolio ?? false);
  const [isGrantor, setIsGrantor] = useState<boolean>(editing?.isGrantor ?? false);
  const [value, setValue] = useState<string>(editing?.value ?? "");
  const [basis, setBasis] = useState<string>(editing?.basis ?? "");
  const [owners, setOwners] = useState<AccountOwner[]>(
    editing?.owners && editing.owners.length > 0 ? editing.owners : defaultOwners(familyMembers),
  );
  const [notes, setNotes] = useState<string>(editing?.notes ?? "");
  const isEdit = Boolean(editing);

  const handleAssetTabOp = useCallback(async (op: AssetTabOp) => {
    if (!editing) return;
    const ctx = {
      entityId: editing.id,
      familyMembers: familyMembers.map((m) => ({ id: m.id, role: m.role })),
    };

    const assetType = op.assetType;
    const assetId = op.assetId;

    const currentItem =
      assetType === "account"
        ? (accounts ?? []).find((a) => a.id === assetId)
        : (liabilities ?? []).find((l) => l.id === assetId);

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
      assetType === "account"
        ? `/api/clients/${clientId}/accounts/${assetId}`
        : `/api/clients/${clientId}/liabilities/${assetId}`;

    try {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: assetType,
          targetId: assetId,
          desiredFields: { owners: newOwners },
        },
        {
          url,
          method: "PUT",
          body: { owners: newOwners },
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to update asset ownership");
        return;
      }
    } catch {
      setError("Failed to update asset ownership");
    }
  }, [editing, accounts, liabilities, familyMembers, clientId, writer]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate ownership sum.
    const ownerSum = owners.reduce((s, o) => s + o.percent, 0);
    if (owners.length > 0 && Math.abs(ownerSum - 1) > 0.0001) {
      setError("Owner percentages must sum to 100%.");
      setLoading(false);
      return;
    }

    // The DB schema for entity_owners only supports family_member rows today.
    // Reject entity-on-entity ownership at the form layer with a clear message.
    const familyOnly = owners.filter((o) => o.kind === "family_member") as Extract<AccountOwner, { kind: "family_member" }>[];
    if (familyOnly.length !== owners.length) {
      setError("Business owners must be household members.");
      setLoading(false);
      return;
    }

    const body = {
      name: name.trim(),
      entityType,
      notes: notes || null,
      includeInPortfolio,
      isGrantor,
      value: value || "0",
      basis: basis || "0",
      owners: familyOnly.map((o) => ({ familyMemberId: o.familyMemberId, percent: o.percent })),
      grantor: null,
      beneficiaries: null,
      trustSubType: undefined,
      isIrrevocable: undefined,
      trustee: undefined,
      exemptionConsumed: undefined,
    };

    try {
      const newEntityId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = isEdit
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "entity",
              targetId: editing!.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/entities/${editing!.id}`,
              method: "PUT",
              body,
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "entity",
              entity: { id: newEntityId, ...body },
            },
            {
              url: `/api/clients/${clientId}/entities`,
              method: "POST",
              body,
            },
          );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      const saved: Entity = writer.scenarioActive
        ? ({
            id: isEdit ? editing!.id : newEntityId,
            ...body,
            owners: familyOnly,
          } as unknown as Entity)
        : ((await res.json()) as Entity);
      onSaved(saved, isEdit ? "edit" : "create");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="entity-business-form" onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className={activeTab !== "details" ? "hidden" : ""}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={fieldLabelClassName} htmlFor="ent-name">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="ent-name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Smith Holdings LLC"
              className={inputClassName}
            />
          </div>

          <div className="col-span-2">
            <label className={fieldLabelClassName} htmlFor="ent-type">Type</label>
            <select
              id="ent-type"
              name="entityType"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as BusinessEntityType)}
              className={selectClassName}
            >
              {Object.entries(BUSINESS_ENTITY_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <OwnershipEditor
              familyMembers={familyMembers}
              entities={(otherEntities ?? []).filter((e) => e.id !== editing?.id)}
              value={owners}
              onChange={setOwners}
            />
          </div>

          <div>
            <label className={fieldLabelClassName} htmlFor="ent-value">
              Current Value ($)
            </label>
            <CurrencyInput
              id="ent-value"
              value={value}
              onChange={(raw) => setValue(raw)}
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-gray-400">
              Standalone equity value. Owned accounts are tracked separately on the Assets tab.
            </p>
          </div>

          <div>
            <label className={fieldLabelClassName} htmlFor="ent-basis">
              Cost Basis ($)
            </label>
            <CurrencyInput
              id="ent-basis"
              value={basis}
              onChange={(raw) => setBasis(raw)}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-800 bg-gray-900/60 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            Cash-flow treatment
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInPortfolio}
              onChange={(e) => setIncludeInPortfolio(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
            />
            <span className="text-sm text-gray-200">
              Include this entity&apos;s accounts in portfolio assets
              <span className="block text-xs text-gray-400">
                Balances roll into the cash-flow portfolio view even though the assets are out of estate.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isGrantor}
              onChange={(e) => setIsGrantor(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
            />
            <span className="text-sm text-gray-200">
              Pass-through taxation (taxes paid by household)
              <span className="block text-xs text-gray-400">
                Income, capital gains, and RMDs from this entity&apos;s accounts are taxed at the household rate.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className={activeTab !== "assets" ? "hidden" : ""}>
        {editing && accounts !== undefined ? (
          <AssetsTab
            entityId={editing.id}
            accounts={accounts ?? []}
            liabilities={liabilities ?? []}
            incomes={incomes ?? []}
            expenses={expenses ?? []}
            familyMembers={familyMembers}
            entities={otherEntities ?? []}
            entityLabel="business"
            onChange={handleAssetTabOp}
          />
        ) : (
          <p className="text-[13px] text-ink-3 text-center py-6">
            Asset management is available when editing an existing business.
          </p>
        )}
      </div>

      <div className={activeTab !== "notes" ? "hidden" : ""}>
        <label className={fieldLabelClassName} htmlFor="ent-notes">Notes</label>
        <textarea
          id="ent-notes"
          name="notes"
          rows={8}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={textareaClassName}
        />
      </div>
    </form>
  );
}
