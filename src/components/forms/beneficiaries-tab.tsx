"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Designation,
  FamilyMember,
  ExternalBeneficiary,
  Tier,
} from "../family-view";

interface BeneficiariesTabProps {
  clientId: string;
  accountId: string;
  active: boolean;
}

function AccountBeneficiaryEditor({
  clientId,
  accountId,
  members,
  externals,
  initial,
  onSaved,
}: {
  clientId: string;
  accountId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  initial: Designation[];
  onSaved: (rows: Designation[]) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Designation[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const url = `/api/clients/${clientId}/accounts/${accountId}/beneficiaries`;

  const byTier = (tier: Tier) => rows.filter((r) => r.tier === tier);
  const sumTier = (tier: Tier) =>
    byTier(tier).reduce((acc, r) => acc + (isFinite(r.percentage) ? r.percentage : 0), 0);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = rows.map((r) => ({
        tier: r.tier,
        percentage: r.percentage,
        familyMemberId: r.familyMemberId ?? undefined,
        externalBeneficiaryId: r.externalBeneficiaryId ?? undefined,
        sortOrder: r.sortOrder,
      }));
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const saved = (await res.json()) as Designation[];
      const normalized = saved.map((d) => ({
        ...d,
        percentage:
          typeof d.percentage === "string" ? parseFloat(d.percentage) : d.percentage,
      }));
      setRows(normalized);
      onSaved(normalized);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addRow(tier: Tier) {
    setRows((r) => [
      ...r,
      {
        id: `tmp-${Math.random()}`,
        targetKind: "account",
        accountId,
        entityId: null,
        tier,
        familyMemberId: null,
        externalBeneficiaryId: null,
        entityIdRef: null,
        householdRole: null,
        percentage: 0,
        sortOrder: r.length,
      },
    ]);
  }

  function updateRow(id: string, patch: Partial<Designation>) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeRow(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
  }

  const renderTier = (tier: Tier) => {
    const tierRows = byTier(tier);
    const sum = sumTier(tier);
    const sumOk = tierRows.length === 0 || Math.abs(sum - 100) <= 0.01;
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold capitalize text-gray-200">{tier}</h4>
          <span className={sumOk ? "text-xs text-green-400" : "text-xs text-amber-400"}>
            sum: {sum.toFixed(2)}%
          </span>
        </div>
        <ul className="mt-1 space-y-1">
          {tierRows.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <select
                value={
                  r.familyMemberId
                    ? `fm:${r.familyMemberId}`
                    : r.externalBeneficiaryId
                      ? `ext:${r.externalBeneficiaryId}`
                      : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("fm:")) {
                    updateRow(r.id, { familyMemberId: v.slice(3), externalBeneficiaryId: null });
                  } else if (v.startsWith("ext:")) {
                    updateRow(r.id, { externalBeneficiaryId: v.slice(4), familyMemberId: null });
                  } else {
                    updateRow(r.id, { familyMemberId: null, externalBeneficiaryId: null });
                  }
                }}
                className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">— select beneficiary —</option>
                <optgroup label="Family">
                  {members.map((m) => (
                    <option key={m.id} value={`fm:${m.id}`}>
                      {m.firstName} {m.lastName ?? ""} ({m.relationship})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="External">
                  {externals.map((x) => (
                    <option key={x.id} value={`ext:${x.id}`}>
                      {x.name} ({x.kind})
                    </option>
                  ))}
                </optgroup>
              </select>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={r.percentage}
                onChange={(e) => updateRow(r.id, { percentage: parseFloat(e.target.value) || 0 })}
                className="w-24 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              />
              <span className="text-sm text-gray-300">%</span>
              <button
                type="button"
                onClick={() => removeRow(r.id)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => addRow(tier)}
          className="mt-1 text-xs text-blue-400 hover:text-blue-300"
        >
          + add {tier}
        </button>
      </div>
    );
  };

  return (
    <div className="mt-3 border-t border-gray-800 pt-3">
      {renderTier("primary")}
      {renderTier("contingent")}
      {saveError && <div className="mt-2 text-sm text-red-400">{saveError}</div>}
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save beneficiaries"}
      </button>
    </div>
  );
}

export default function BeneficiariesTab({ clientId, accountId, active }: BeneficiariesTabProps) {
  const [loaded, setLoaded] = useState(false);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [externals, setExternals] = useState<ExternalBeneficiary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || loaded) return;
    setError(null);
    let cancelled = false;
    async function load() {
      try {
        const [dRes, mRes, eRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/accounts/${accountId}/beneficiaries`),
          fetch(`/api/clients/${clientId}/family-members`),
          fetch(`/api/clients/${clientId}/external-beneficiaries`),
        ]);
        if (!dRes.ok || !mRes.ok || !eRes.ok) throw new Error("Failed to load beneficiary data");
        const [d, m, e] = (await Promise.all([dRes.json(), mRes.json(), eRes.json()])) as [
          Designation[],
          FamilyMember[],
          ExternalBeneficiary[],
        ];
        if (cancelled) return;
        setDesignations(d);
        setMembers(m);
        setExternals(e);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [active, loaded, clientId, accountId]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!loaded) return <p className="text-sm text-gray-300">Loading…</p>;

  return (
    <AccountBeneficiaryEditor
      clientId={clientId}
      accountId={accountId}
      members={members}
      externals={externals}
      initial={designations}
      onSaved={(rows) => setDesignations(rows)}
    />
  );
}
