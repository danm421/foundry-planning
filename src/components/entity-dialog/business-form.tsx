"use client";

import { useState } from "react";
import type { Entity } from "../family-view";
import type { EntityFormCommonProps } from "./types";

type BusinessEntityType = "llc" | "s_corp" | "c_corp" | "partnership" | "other";

const BUSINESS_ENTITY_TYPE_LABELS: Record<BusinessEntityType, string> = {
  llc: "LLC",
  s_corp: "S Corp",
  c_corp: "C Corp",
  partnership: "Partnership",
  other: "Other",
};

export default function BusinessForm({
  clientId,
  editing,
  onSaved,
  onRequestDelete,
  onClose,
}: EntityFormCommonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const url = isEdit
        ? `/api/clients/${clientId}/entities/${editing!.id}`
        : `/api/clients/${clientId}/entities`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      const saved = (await res.json()) as Entity;
      onSaved(saved, isEdit ? "edit" : "create");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-300" htmlFor="ent-name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="ent-name"
            name="name"
            type="text"
            required
            defaultValue={editing?.name ?? ""}
            placeholder="e.g., Smith Family Trust"
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="ent-type">Type</label>
          <select
            id="ent-type"
            name="entityType"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as BusinessEntityType)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {Object.entries(BUSINESS_ENTITY_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="ent-value">
            Value ($)
          </label>
          <input
            id="ent-value"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Shown as an out-of-estate asset on the balance sheet.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="ent-owner">
            Owner
          </label>
          <select
            id="ent-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value as typeof owner)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">—</option>
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
            <option value="joint">Joint</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300" htmlFor="ent-notes">Notes</label>
        <textarea
          id="ent-notes"
          name="notes"
          rows={2}
          defaultValue={editing?.notes ?? ""}
          className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Cash-flow treatment
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInPortfolio}
            onChange={(e) => setIncludeInPortfolio(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-200">
            Include this entity&apos;s accounts in portfolio assets
            <span className="block text-[11px] text-gray-500">
              Balances roll into the cash-flow portfolio view even though the assets are out of estate.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isGrantor}
            onChange={(e) => setIsGrantor(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-200">
            Grantor trust (taxes paid by household)
            <span className="block text-[11px] text-gray-500">
              Income, capital gains, and RMDs from this entity&apos;s accounts are taxed at the household rate.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between pt-2">
        {isEdit && onRequestDelete ? (
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
          >
            Delete…
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Add"}
        </button>
      </div>
    </form>
  );
}
