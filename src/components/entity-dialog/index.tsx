"use client";

import { useState } from "react";
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
import {
  ENTITY_LABELS,
  TrashIcon,
  type Entity,
  type EntityType,
  type NamePctRow,
} from "../family-view";

const BUSINESS_ENTITY_TYPES: EntityType[] = ["llc", "s_corp", "c_corp", "partnership", "other"];
const TRUST_LIKE_ENTITY_TYPES: EntityType[] = ["trust", "foundation"];

const TRUST_SUB_TYPE_LABELS: Record<TrustSubType, string> = {
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

interface NamePctListProps {
  label: string;
  rows: NamePctRow[];
  onChange: (rows: NamePctRow[]) => void;
}

function NamePctList({ label, rows, onChange }: NamePctListProps) {
  const total = rows.reduce((sum, r) => sum + (Number(r.pct) || 0), 0);
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        <button
          type="button"
          onClick={() => onChange([...rows, { name: "", pct: 0 }])}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-500">None</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Name"
                value={row.name}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], name: e.target.value };
                  onChange(next);
                }}
                className="flex-1 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="%"
                value={row.pct || ""}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], pct: Number(e.target.value) };
                  onChange(next);
                }}
                className="w-20 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="text-gray-500 hover:text-red-400"
                aria-label={`Remove ${label.toLowerCase()} row`}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <p className={`text-right text-[11px] ${Math.abs(total - 100) < 0.01 || total === 0 ? "text-gray-500" : "text-amber-400"}`}>
            Total: {total.toFixed(2)}%
          </p>
        </div>
      )}
    </div>
  );
}

export interface EntityDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
}

export default function EntityDialog({ clientId, open, onOpenChange, editing, onSaved, onRequestDelete }: EntityDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<EntityType>(editing?.entityType ?? "trust");
  const [includeInPortfolio, setIncludeInPortfolio] = useState<boolean>(editing?.includeInPortfolio ?? false);
  const [isGrantor, setIsGrantor] = useState<boolean>(editing?.isGrantor ?? false);
  const [value, setValue] = useState<string>(editing?.value ?? "0");
  const [owner, setOwner] = useState<"client" | "spouse" | "joint" | "">(editing?.owner ?? "");
  const [grantor, setGrantor] = useState<"client" | "spouse" | "">(editing?.grantor ?? "");
  const [beneficiaries, setBeneficiaries] = useState<NamePctRow[]>(editing?.beneficiaries ?? []);
  const [trustSubType, setTrustSubType] = useState<TrustSubType | "">(
    (editing?.trustSubType as TrustSubType | null) ?? "",
  );
  const [trustee, setTrustee] = useState<string>(editing?.trustee ?? "");
  const [exemptionConsumed, setExemptionConsumed] = useState<string>(
    editing?.exemptionConsumed ?? "0",
  );
  const isEdit = Boolean(editing);
  const showBusinessFields = BUSINESS_ENTITY_TYPES.includes(entityType);
  const showTrustFields = TRUST_LIKE_ENTITY_TYPES.includes(entityType);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const submittedType = data.get("entityType") as EntityType;
    if (submittedType === "trust" && trustSubType === "") {
      setError("Please pick a trust sub-type.");
      return;
    }
    setLoading(true);
    setError(null);
    const submittedShowBusiness = BUSINESS_ENTITY_TYPES.includes(submittedType);
    const submittedShowTrust = TRUST_LIKE_ENTITY_TYPES.includes(submittedType);
    const body = {
      name: data.get("name") as string,
      entityType: submittedType,
      notes: (data.get("notes") as string) || null,
      includeInPortfolio,
      isGrantor,
      value: submittedShowBusiness ? value || "0" : "0",
      owner: submittedShowBusiness && owner ? owner : null,
      grantor: submittedShowTrust ? (grantor || null) : null,
      beneficiaries: submittedShowTrust ? beneficiaries.filter((b) => b.name.trim().length > 0) : null,
      trustSubType: submittedType === "trust" ? (trustSubType as TrustSubType) : undefined,
      isIrrevocable:
        submittedType === "trust" ? deriveIsIrrevocable(trustSubType as TrustSubType) : undefined,
      trustee: submittedType === "trust" ? (trustee.trim() || null) : undefined,
      exemptionConsumed:
        submittedType === "trust" ? Number(exemptionConsumed || "0") : undefined,
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
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg bg-gray-900 border border-gray-600 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Entity" : "Add Entity"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

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
                onChange={(e) => setEntityType(e.target.value as EntityType)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {Object.entries(ENTITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          {showBusinessFields && (
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
          )}

          {showTrustFields && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="ent-grantor">
                  Grantor
                </label>
                <select
                  id="ent-grantor"
                  name="grantor"
                  value={grantor}
                  onChange={(e) => setGrantor(e.target.value as "client" | "spouse" | "")}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Third party (none)</option>
                  <option value="client">Client</option>
                  <option value="spouse">Spouse</option>
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  Whose lifetime exemption is consumed by gifts to this trust. Leave as
                  &ldquo;Third party&rdquo; for trusts created by someone outside the household.
                </p>
              </div>
              <NamePctList
                label="Beneficiaries"
                rows={beneficiaries}
                onChange={setBeneficiaries}
              />
            </div>
          )}

          {entityType === "trust" && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="ent-subtype">
                  Sub-type
                </label>
                <select
                  id="ent-subtype"
                  value={trustSubType}
                  onChange={(e) => setTrustSubType(e.target.value as TrustSubType | "")}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="" disabled>— select sub-type —</option>
                  {Object.entries(TRUST_SUB_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  {trustSubType === ""
                    ? "Pick a sub-type to classify this trust."
                    : deriveIsIrrevocable(trustSubType as TrustSubType)
                      ? "Treated as irrevocable (out-of-estate in future engine work)."
                      : "Treated as revocable (in-estate)."}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="ent-trustee">
                  Trustee
                </label>
                <input
                  id="ent-trustee"
                  type="text"
                  value={trustee}
                  onChange={(e) => setTrustee(e.target.value)}
                  placeholder="e.g., Linda, or Fidelity Trust Co."
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Free text. Separate co-trustees with commas.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="ent-exemption">
                  Opening balance (legacy) ($)
                </label>
                <input
                  id="ent-exemption"
                  type="number"
                  step="1000"
                  min="0"
                  value={exemptionConsumed}
                  onChange={(e) => setExemptionConsumed(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Historical exemption already used before you started tracking individual gifts. Gifts added below stack on top.
                </p>
              </div>
            </div>
          )}

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
      </div>
    </div>
  );
}
