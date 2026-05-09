"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Designation,
  FamilyMember,
  ExternalBeneficiary,
  Tier,
} from "./family-view";
import { redistribute, splitEvenly } from "./forms/auto-split-percentages";

interface InsurancePolicyBeneficiariesTabProps {
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  mode: "create" | "edit";
  policyId?: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
}

// DB rows ship `percentage` as a decimal string. `Designation` wants a number,
// so we normalize here before handing to BeneficiaryEditor.
type DesignationRow = Omit<Designation, "percentage"> & {
  percentage: number | string;
};

function normalize(rows: DesignationRow[]): Designation[] {
  return rows.map((r) => ({
    ...r,
    percentage:
      typeof r.percentage === "string" ? parseFloat(r.percentage) : r.percentage,
  }));
}

function AccountBeneficiaryEditor({
  clientId,
  accountId,
  clientFirstName,
  spouseFirstName,
  members,
  externals,
  initial,
}: {
  clientId: string;
  accountId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  initial: Designation[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Designation[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const url = `/api/clients/${clientId}/accounts/${accountId}/beneficiaries`;

  const byTier = (tier: Tier) => rows.filter((r) => r.tier === tier);
  const sumTier = (tier: Tier) =>
    byTier(tier).reduce((acc, r) => acc + (isFinite(r.percentage) ? r.percentage : 0), 0);

  const setRowPct = (r: Designation, percentage: number): Designation => ({ ...r, percentage });
  const getRowKey = (r: Designation): string => r.id;

  function applyToTier(allRows: Designation[], tier: Tier, locked: ReadonlySet<string>): Designation[] {
    const tierRows = allRows.filter((r) => r.tier === tier);
    const balanced = redistribute(tierRows, locked, getRowKey, setRowPct);
    const balancedById = new Map(balanced.map((r) => [r.id, r]));
    return allRows.map((r) => balancedById.get(r.id) ?? r);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = rows.map((r) => ({
        tier: r.tier,
        percentage: r.percentage,
        familyMemberId: r.familyMemberId ?? undefined,
        externalBeneficiaryId: r.externalBeneficiaryId ?? undefined,
        householdRole: r.householdRole ?? undefined,
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
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addRow(tier: Tier) {
    setRows((r) => {
      const newRow: Designation = {
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
      };
      const tierWasEmpty = r.filter((x) => x.tier === tier).length === 0;
      if (tierWasEmpty) {
        return [...r, { ...newRow, percentage: splitEvenly(1)[0] }];
      }
      return applyToTier([...r, newRow], tier, lockedKeys);
    });
  }

  function updateRow(id: string, patch: Partial<Designation>) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function changePercentage(id: string, tier: Tier, pct: number) {
    const nextLocked = new Set(lockedKeys);
    nextLocked.add(id);
    setLockedKeys(nextLocked);
    setRows((r) => {
      const updated = r.map((x) => (x.id === id ? { ...x, percentage: pct } : x));
      return applyToTier(updated, tier, nextLocked);
    });
  }

  function removeRow(id: string) {
    const removedRow = rows.find((r) => r.id === id);
    const tier =
      removedRow?.tier === "primary" || removedRow?.tier === "contingent"
        ? removedRow.tier
        : null;
    const nextLocked = new Set(lockedKeys);
    nextLocked.delete(id);
    setLockedKeys(nextLocked);
    setRows((r) => {
      const remaining = r.filter((x) => x.id !== id);
      return tier ? applyToTier(remaining, tier, nextLocked) : remaining;
    });
  }

  // Family-only beneficiaries — exclude household principals (client/spouse).
  // Without a `role`, fall back to the legacy behavior of including the row.
  const familyMembers = members.filter(
    (m) => m.role !== "client" && m.role !== "spouse",
  );
  // "Children" for the split-among-children helper. Legacy data may set the
  // client/spouse with relationship="child" (the schema default), so also
  // filter by role here to avoid splitting onto the household principals.
  const children = familyMembers.filter((m) => m.relationship === "child");

  function splitAmongChildren(tier: Tier) {
    if (children.length === 0) return;
    const pcts = splitEvenly(children.length);
    const childRows: Designation[] = children.map((child, i) => ({
      id: `tmp-${Math.random()}`,
      targetKind: "account",
      accountId,
      entityId: null,
      tier,
      familyMemberId: child.id,
      externalBeneficiaryId: null,
      entityIdRef: null,
      householdRole: null,
      percentage: pcts[i],
      sortOrder: i,
    }));
    setRows((r) => [...r.filter((x) => x.tier !== tier), ...childRows]);
    setLockedKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        const row = rows.find((r) => r.id === key);
        if (row && row.tier !== tier) next.add(key);
      }
      return next;
    });
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
                  r.householdRole
                    ? `hh:${r.householdRole}`
                    : r.familyMemberId
                      ? `fm:${r.familyMemberId}`
                      : r.externalBeneficiaryId
                        ? `ext:${r.externalBeneficiaryId}`
                        : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("hh:")) {
                    const role = v.slice(3) as "client" | "spouse";
                    updateRow(r.id, {
                      householdRole: role,
                      familyMemberId: null,
                      externalBeneficiaryId: null,
                    });
                  } else if (v.startsWith("fm:")) {
                    updateRow(r.id, {
                      familyMemberId: v.slice(3),
                      externalBeneficiaryId: null,
                      householdRole: null,
                    });
                  } else if (v.startsWith("ext:")) {
                    updateRow(r.id, {
                      externalBeneficiaryId: v.slice(4),
                      familyMemberId: null,
                      householdRole: null,
                    });
                  } else {
                    updateRow(r.id, {
                      familyMemberId: null,
                      externalBeneficiaryId: null,
                      householdRole: null,
                    });
                  }
                }}
                className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
              >
                <option value="">— select beneficiary —</option>
                <optgroup label="Household">
                  <option value="hh:client">{clientFirstName} (client)</option>
                  {spouseFirstName && (
                    <option value="hh:spouse">{spouseFirstName} (spouse)</option>
                  )}
                </optgroup>
                <optgroup label="Family">
                  {familyMembers.map((m) => (
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
                onChange={(e) => changePercentage(r.id, tier, parseFloat(e.target.value) || 0)}
                className="w-24 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 focus:border-accent focus:outline-none"
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
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => addRow(tier)}
            className="text-xs text-accent hover:text-accent-ink"
          >
            + add {tier}
          </button>
          {children.length > 0 && (
            <button
              type="button"
              onClick={() => splitAmongChildren(tier)}
              className="text-xs text-gray-400 hover:text-gray-200"
              title={`Replace with ${children.length} child${children.length === 1 ? "" : "ren"}, split evenly`}
            >
              Split among children
            </button>
          )}
        </div>
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
        className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save beneficiaries"}
      </button>
    </div>
  );
}

export default function InsurancePolicyBeneficiariesTab({
  clientId,
  clientFirstName,
  spouseFirstName,
  mode,
  policyId,
  members,
  externals,
}: InsurancePolicyBeneficiariesTabProps) {
  const isCreate = mode === "create" || !policyId;

  const [loading, setLoading] = useState(!isCreate);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/accounts/${policyId}/beneficiaries`,
        );
        if (cancelled) return;
        if (res.status === 401) {
          setError("Unauthorized");
          setLoading(false);
          return;
        }
        if (res.status === 404) {
          // Policy exists but has no designations yet — let the editor start
          // from an empty list.
          setDesignations([]);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const rows = (await res.json()) as DesignationRow[];
        if (cancelled) return;
        setDesignations(normalize(rows));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isCreate, clientId, policyId]);

  if (isCreate) {
    return (
      <div className="py-6">
        <div className="rounded-md border border-hair bg-card-2 px-4 py-3 text-sm text-ink-3">
          Save the policy first. Beneficiaries can be set after the policy has
          been created.
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="py-6 text-sm text-ink-3">Loading…</p>;
  }

  if (error) {
    return <p className="py-6 text-sm text-crit">{error}</p>;
  }

  return (
    <AccountBeneficiaryEditor
      clientId={clientId}
      accountId={policyId!}
      clientFirstName={clientFirstName}
      spouseFirstName={spouseFirstName}
      members={members}
      externals={externals}
      initial={designations}
    />
  );
}
