"use client";

import { useEffect, useState } from "react";
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
import type {
  Designation,
  Entity,
  ExternalBeneficiary,
  FamilyMember,
  NamePctRow,
} from "../family-view";
import BeneficiaryEditor from "../beneficiary-editor";
import NamePctList from "./name-pct-list";
import type { EntityFormCommonProps } from "./types";

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

type TrustEntityType = "trust" | "foundation";

const TRUST_ENTITY_TYPE_LABELS: Record<TrustEntityType, string> = {
  trust: "Trust",
  foundation: "Foundation",
};

export default function TrustForm({
  clientId,
  editing,
  onSaved,
  onRequestDelete,
  onClose,
  initialTab,
  lockTab,
}: EntityFormCommonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<TrustEntityType>(
    (editing?.entityType as TrustEntityType | undefined) ?? "trust",
  );
  const [includeInPortfolio, setIncludeInPortfolio] = useState<boolean>(editing?.includeInPortfolio ?? false);
  const [isGrantor, setIsGrantor] = useState<boolean>(editing?.isGrantor ?? false);
  const [grantor, setGrantor] = useState<"client" | "spouse" | "">(editing?.grantor ?? "");
  const [beneficiaries, setBeneficiaries] = useState<NamePctRow[]>(editing?.beneficiaries ?? []);
  const [trustSubType, setTrustSubType] = useState<TrustSubType | "">(
    (editing?.trustSubType as TrustSubType | null) ?? "",
  );
  const [trustee, setTrustee] = useState<string>(editing?.trustee ?? "");
  const [exemptionConsumed, setExemptionConsumed] = useState<string>(editing?.exemptionConsumed ?? "0");
  const isEdit = Boolean(editing);

  const [activeTab, setActiveTab] = useState<"details" | "beneficiaries">(
    lockTab ? "beneficiaries" : (initialTab ?? "details"),
  );

  const [designations, setDesignations] = useState<Designation[] | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [externals, setExternals] = useState<ExternalBeneficiary[]>([]);
  const [beneDataLoaded, setBeneDataLoaded] = useState(false);
  const [beneDataLoading, setBeneDataLoading] = useState(false);
  const [beneLoadError, setBeneLoadError] = useState<string | null>(null);

  async function loadBeneficiariesData() {
    if (beneDataLoaded || beneDataLoading || !editing) return;
    setBeneDataLoading(true);
    setBeneLoadError(null);
    try {
      const [desigRes, membersRes, externalsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/entities/${editing.id}/beneficiaries`),
        fetch(`/api/clients/${clientId}/family-members`),
        fetch(`/api/clients/${clientId}/external-beneficiaries`),
      ]);
      if (!desigRes.ok || !membersRes.ok || !externalsRes.ok) {
        throw new Error("Failed to load beneficiaries data");
      }
      const [desig, mem, ext] = await Promise.all([
        desigRes.json(),
        membersRes.json(),
        externalsRes.json(),
      ]);
      setDesignations(desig as Designation[]);
      setMembers(mem as FamilyMember[]);
      setExternals(ext as ExternalBeneficiary[]);
      setBeneDataLoaded(true);
    } catch (err) {
      setBeneLoadError(err instanceof Error ? err.message : "Failed to load beneficiaries");
    } finally {
      setBeneDataLoading(false);
    }
  }

  useEffect(() => {
    if (entityType !== "trust" && activeTab === "beneficiaries") {
      setActiveTab("details");
    }
  }, [entityType, activeTab]);

  // When deep-linked to the Beneficiaries tab, eagerly fetch its data since
  // the user never clicks the tab button (either because lockTab hides the
  // Details tab, or because initialTab opens us directly on Beneficiaries).
  useEffect(() => {
    if (activeTab === "beneficiaries" && entityType === "trust") {
      void loadBeneficiariesData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (entityType === "trust" && trustSubType === "") {
      setError("Please pick a trust sub-type.");
      return;
    }
    const data = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    const body = {
      name: data.get("name") as string,
      entityType,
      notes: (data.get("notes") as string) || null,
      includeInPortfolio,
      isGrantor,
      value: "0",
      owner: null,
      grantor: grantor || null,
      beneficiaries: beneficiaries.filter((b) => b.name.trim().length > 0),
      trustSubType: entityType === "trust" ? (trustSubType as TrustSubType) : undefined,
      isIrrevocable:
        entityType === "trust" ? deriveIsIrrevocable(trustSubType as TrustSubType) : undefined,
      trustee: entityType === "trust" ? (trustee.trim() || null) : undefined,
      exemptionConsumed: entityType === "trust" ? Number(exemptionConsumed || "0") : undefined,
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
    <div>
      {entityType === "trust" && (
        <div className="flex border-b border-gray-700 mb-4">
          {!lockTab && (
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "details"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              Details
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setActiveTab("beneficiaries");
              void loadBeneficiariesData();
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "beneficiaries"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            Beneficiaries
          </button>
        </div>
      )}

      {!lockTab && (
      <div className={activeTab !== "details" ? "hidden" : ""}>
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
            onChange={(e) => setEntityType(e.target.value as TrustEntityType)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {Object.entries(TRUST_ENTITY_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

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
      )}

      {entityType === "trust" && (
        <div className={activeTab !== "beneficiaries" ? "hidden" : ""}>
          {!editing ? (
            <p className="text-sm text-gray-400">
              Save the trust first, then designate remainder beneficiaries.
            </p>
          ) : !beneDataLoaded ? (
            beneLoadError ? (
              <p className="text-sm text-red-400">{beneLoadError}</p>
            ) : (
              <p className="text-sm text-gray-400">Loading…</p>
            )
          ) : (
            <BeneficiaryEditor
              target={{ kind: "trust", entityId: editing.id }}
              clientId={clientId}
              members={members}
              externals={externals}
              initial={designations ?? []}
              onSaved={(rows) => setDesignations(rows)}
            />
          )}
        </div>
      )}
    </div>
  );
}
