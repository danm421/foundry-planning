"use client";

import { useEffect, useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import type { Entity } from "../family-view";
import type { EntityFormCommonProps } from "./types";
import { inputClassName, selectClassName, textareaClassName, fieldLabelClassName } from "../forms/input-styles";

type BusinessEntityType = "llc" | "s_corp" | "c_corp" | "partnership" | "other";

const BUSINESS_ENTITY_TYPE_LABELS: Record<BusinessEntityType, string> = {
  llc: "LLC",
  s_corp: "S Corp",
  c_corp: "C Corp",
  partnership: "Partnership",
  other: "Other",
};

interface BusinessFormProps extends EntityFormCommonProps {
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
}

export default function BusinessForm({
  clientId,
  editing,
  onSaved,
  onClose,
  onSubmitStateChange,
}: BusinessFormProps) {
  const writer = useScenarioWriter(clientId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading, loading });
  }, [loading, onSubmitStateChange]);
  const [entityType, setEntityType] = useState<BusinessEntityType>(
    (editing?.entityType as BusinessEntityType | undefined) ?? "llc",
  );
  const [includeInPortfolio, setIncludeInPortfolio] = useState<boolean>(editing?.includeInPortfolio ?? false);
  const [isGrantor, setIsGrantor] = useState<boolean>(editing?.isGrantor ?? false);
  const [value, setValue] = useState<string>(editing?.value ?? "0");
  const [owner, setOwner] = useState<"client" | "spouse" | "joint" | "">(editing?.owner ?? "");
  const isEdit = Boolean(editing);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    const body = {
      name: data.get("name") as string,
      entityType,
      notes: (data.get("notes") as string) || null,
      includeInPortfolio,
      isGrantor,
      value: value || "0",
      owner: owner || null,
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
            defaultValue={editing?.name ?? ""}
            placeholder="e.g., Smith Family Trust"
            className={inputClassName}
          />
        </div>

        <div>
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="ent-value">
            Value ($)
          </label>
          <input
            id="ent-value"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-gray-400">
            Shown as an out-of-estate asset on the balance sheet.
          </p>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="ent-owner">
            Owner
          </label>
          <select
            id="ent-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value as typeof owner)}
            className={selectClassName}
          >
            <option value="">—</option>
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
            <option value="joint">Joint</option>
          </select>
        </div>
      </div>

      <div>
        <label className={fieldLabelClassName} htmlFor="ent-notes">Notes</label>
        <textarea
          id="ent-notes"
          name="notes"
          rows={2}
          defaultValue={editing?.notes ?? ""}
          className={textareaClassName}
        />
      </div>

      <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3 space-y-2">
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
            Grantor trust (taxes paid by household)
            <span className="block text-xs text-gray-400">
              Income, capital gains, and RMDs from this entity&apos;s accounts are taxed at the household rate.
            </span>
          </span>
        </label>
      </div>

    </form>
  );
}
