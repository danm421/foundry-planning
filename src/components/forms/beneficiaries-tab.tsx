"use client";

import { useEffect, useState } from "react";
import type {
  Designation,
  FamilyMember,
  ExternalBeneficiary,
  Tier,
} from "../family-view";
import { redistribute, splitEvenly } from "./auto-split-percentages";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import type { BeneficiaryRef } from "@/engine/types";

interface BeneficiariesTabProps {
  clientId: string;
  accountId: string;
  active: boolean;
}

// `beneficiary_designations.percentage` is a Postgres `decimal`, which Drizzle
// surfaces as a string. Coerce to a number at the trust boundary so downstream
// arithmetic (tier sums) doesn't silently string-concatenate.
function normalizeDesignations(rows: Designation[]): Designation[] {
  return rows.map((d) => ({
    ...d,
    percentage:
      typeof d.percentage === "string" ? parseFloat(d.percentage) : d.percentage,
  }));
}

function AccountBeneficiaryEditor({
  clientId,
  accountId,
  members,
  externals,
  entities,
  initial,
  onSaved,
}: {
  clientId: string;
  accountId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Array<{ id: string; name: string }>;
  initial: Designation[];
  onSaved: (rows: Designation[]) => void;
}) {
  const writer = useScenarioWriter(clientId);
  const [rows, setRows] = useState<Designation[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Tracks which rows the user has manually edited this session. Rows loaded
  // from the server start unlocked, so the first add inside an existing list
  // still triggers an even split.
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const url = `/api/clients/${clientId}/accounts/${accountId}/beneficiaries`;

  const byTier = (tier: Tier) => rows.filter((r) => r.tier === tier);
  const sumTier = (tier: Tier) =>
    byTier(tier).reduce((acc, r) => acc + (isFinite(r.percentage) ? r.percentage : 0), 0);

  // Auto-split helpers (Foundry Planning Fix #10) — apply on a per-tier basis
  // since primary and contingent each sum to 100 independently.
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
      const baseBody = rows.map((r) => ({
        tier: r.tier,
        percentage: r.percentage,
        familyMemberId: r.familyMemberId ?? undefined,
        externalBeneficiaryId: r.externalBeneficiaryId ?? undefined,
        entityIdRef: r.entityIdRef ?? undefined,
        householdRole: r.householdRole ?? undefined,
        sortOrder: r.sortOrder,
      }));
      // Scenario-overlay shape: a full BeneficiaryRef[] fat-field on the account.
      // Row ids are stable uuids assigned at creation time — no remapping needed.
      const refs: BeneficiaryRef[] = rows
        .filter((r) => r.tier === "primary" || r.tier === "contingent")
        .map((r) => ({
          id: r.id,
          tier: r.tier as "primary" | "contingent",
          percentage: r.percentage,
          familyMemberId: r.familyMemberId ?? undefined,
          externalBeneficiaryId: r.externalBeneficiaryId ?? undefined,
          entityIdRef: r.entityIdRef ?? undefined,
          householdRole: r.householdRole ?? undefined,
          sortOrder: r.sortOrder,
        }));
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "account",
          targetId: accountId,
          desiredFields: { beneficiaries: refs },
        },
        { url, method: "PUT", body: baseBody },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      // Base mode returns the saved rows; scenario mode returns the change row.
      // Only re-sync local state from a base-mode response (an array).
      // Scenario mode intentionally skips setRows/onSaved — the response is a
      // scenario_change row, not designations; useScenarioWriter triggers router.refresh().
      const saved = await res.json().catch(() => null);
      if (Array.isArray(saved)) {
        const normalized = normalizeDesignations(saved as Designation[]);
        setRows(normalized);
        onSaved(normalized);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addRow(tier: Tier) {
    setRows((r) => {
      const newRow: Designation = {
        id: crypto.randomUUID(),
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
    // Account beneficiaries are always primary or contingent — the wider
    // `income`/`remainder` tiers from the post-Phase-1 trust dialog never
    // reach this editor.
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

  const children = members.filter((m) => m.relationship === "child");

  // #8: replace the chosen tier's rows with one row per child, evenly split.
  // Other tier rows + their lock state are left untouched.
  function splitAmongChildren(tier: Tier) {
    if (children.length === 0) return;
    const pcts = splitEvenly(children.length);
    const childRows: Designation[] = children.map((child, i) => ({
      id: crypto.randomUUID(),
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
    // Drop any locks belonging to the replaced tier; preserve the other tier's locks.
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
                  r.familyMemberId
                    ? `fm:${r.familyMemberId}`
                    : r.externalBeneficiaryId
                      ? `ext:${r.externalBeneficiaryId}`
                      : r.entityIdRef
                        ? `ent:${r.entityIdRef}`
                        : r.householdRole
                          ? `hh:${r.householdRole}`
                          : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  const clear = { familyMemberId: null, externalBeneficiaryId: null, entityIdRef: null, householdRole: null };
                  if (v.startsWith("fm:")) updateRow(r.id, { ...clear, familyMemberId: v.slice(3) });
                  else if (v.startsWith("ext:")) updateRow(r.id, { ...clear, externalBeneficiaryId: v.slice(4) });
                  else if (v.startsWith("ent:")) updateRow(r.id, { ...clear, entityIdRef: v.slice(4) });
                  else if (v.startsWith("hh:")) updateRow(r.id, { ...clear, householdRole: v.slice(3) as "client" | "spouse" });
                  else updateRow(r.id, clear);
                }}
                className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
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
                <optgroup label="Household">
                  <option value="hh:client">Client</option>
                  <option value="hh:spouse">Spouse</option>
                </optgroup>
                <optgroup label="Trusts">
                  {entities.map((ent) => (
                    <option key={ent.id} value={`ent:${ent.id}`}>
                      {ent.name}
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

export default function BeneficiariesTab({ clientId, accountId, active }: BeneficiariesTabProps) {
  const [loaded, setLoaded] = useState(false);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [externals, setExternals] = useState<ExternalBeneficiary[]>([]);
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || loaded) return;
    setError(null);
    let cancelled = false;
    async function load() {
      try {
        const [dRes, mRes, eRes, entRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/accounts/${accountId}/beneficiaries`),
          fetch(`/api/clients/${clientId}/family-members`),
          fetch(`/api/clients/${clientId}/external-beneficiaries`),
          fetch(`/api/clients/${clientId}/entities`),
        ]);
        if (!dRes.ok || !mRes.ok || !eRes.ok || !entRes.ok) throw new Error("Failed to load beneficiary data");
        const [d, m, e, ent] = (await Promise.all([dRes.json(), mRes.json(), eRes.json(), entRes.json()])) as [
          Designation[],
          FamilyMember[],
          ExternalBeneficiary[],
          Array<{ id: string; name: string }>,
        ];
        if (cancelled) return;
        setDesignations(normalizeDesignations(d));
        // Household principals (client/spouse) are stored as family_members
        // rows with a defaulted `relationship` of "child". They have their own
        // "Household" optgroup below, so exclude them here to avoid showing
        // them as kin — and to keep them out of the "child" beneficiary list.
        setMembers(m.filter((fm) => fm.role !== "client" && fm.role !== "spouse"));
        setExternals(e);
        setEntities(ent);
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
      entities={entities}
      initial={designations}
      onSaved={(rows) => setDesignations(rows)}
    />
  );
}
