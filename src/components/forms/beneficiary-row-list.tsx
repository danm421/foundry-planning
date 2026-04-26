"use client";

import { useState } from "react";
import type { FamilyMember, ExternalBeneficiary } from "../family-view";
import { fieldLabelClassName } from "./input-styles";
import { redistribute, splitEvenly } from "./auto-split-percentages";

// Visual styling for inline-row fields — same look as inputClassName/selectClassName
// but without `w-full` so flex-1 / explicit widths can take over.
const rowFieldBase =
  "h-9 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink outline-none " +
  "hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

const rowSelectClassName =
  rowFieldBase + " appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] " +
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%238b909c%22><path fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/></svg>')]";

export interface BeneficiaryRow {
  id: string;  // tmp id for React key; not persisted
  source:
    | { kind: "household"; role: "client" | "spouse" }
    | { kind: "family"; familyMemberId: string }
    | { kind: "external"; externalBeneficiaryId: string }
    | { kind: "entity"; entityId: string }
    | { kind: "empty" };
  percentage: number;
}

interface BeneficiaryRowListProps {
  tier: "income" | "remainder";
  allowEntities: boolean;
  rows: BeneficiaryRow[];
  onChange: (rows: BeneficiaryRow[]) => void;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: { id: string; name: string }[];
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
}

const tierLabel = (tier: "income" | "remainder") =>
  tier === "income" ? "Income beneficiaries" : "Remainder beneficiaries";

function rowSourceToValue(s: BeneficiaryRow["source"]): string {
  switch (s.kind) {
    case "household": return `hh:${s.role}`;
    case "family": return `fm:${s.familyMemberId}`;
    case "external": return `ext:${s.externalBeneficiaryId}`;
    case "entity": return `ent:${s.entityId}`;
    case "empty": return "";
  }
}

function valueToRowSource(v: string): BeneficiaryRow["source"] {
  if (v === "") return { kind: "empty" };
  if (v === "hh:client" || v === "hh:spouse") return { kind: "household", role: v.slice(3) as "client" | "spouse" };
  if (v.startsWith("fm:")) return { kind: "family", familyMemberId: v.slice(3) };
  if (v.startsWith("ext:")) return { kind: "external", externalBeneficiaryId: v.slice(4) };
  if (v.startsWith("ent:")) return { kind: "entity", entityId: v.slice(4) };
  return { kind: "empty" };
}

// Helper for use across this file's handlers — applied after add/remove and
// after every user percentage change so unlocked rows always sum to 100%.
const setRowPercentage = (r: BeneficiaryRow, percentage: number): BeneficiaryRow => ({ ...r, percentage });
const getRowKey = (r: BeneficiaryRow): string => r.id;

export default function BeneficiaryRowList({
  tier, allowEntities, rows, onChange, members, externals, entities, household,
}: BeneficiaryRowListProps) {
  // Tracks which rows the user has manually edited in this dialog session.
  // Locked rows keep their percentage on add/remove; unlocked rows split the
  // remainder evenly. Rows loaded from initial props start unlocked, so the
  // first add inside an existing list still triggers an even split.
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const sum = rows.reduce((acc, r) => acc + (Number.isFinite(r.percentage) ? r.percentage : 0), 0);
  const sumOk = rows.length === 0 || Math.abs(sum - 100) <= 0.01;

  function update(idx: number, patch: Partial<BeneficiaryRow>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function changePercentage(idx: number, pct: number) {
    const key = getRowKey(rows[idx]);
    const nextLocked = new Set(lockedKeys);
    nextLocked.add(key);
    setLockedKeys(nextLocked);
    const updated = rows.map((r, i) => (i === idx ? setRowPercentage(r, pct) : r));
    onChange(redistribute(updated, nextLocked, getRowKey, setRowPercentage));
  }

  function remove(idx: number) {
    const removedKey = getRowKey(rows[idx]);
    const nextLocked = new Set(lockedKeys);
    nextLocked.delete(removedKey);
    setLockedKeys(nextLocked);
    const remaining = rows.filter((_, i) => i !== idx);
    onChange(redistribute(remaining, nextLocked, getRowKey, setRowPercentage));
  }

  function add() {
    const newRow: BeneficiaryRow = {
      id: `tmp-${Math.random().toString(36).slice(2)}`,
      source: { kind: "empty" },
      percentage: 0,
    };
    // First-add convenience: if list was empty, default the row to 100% so the
    // user doesn't have to type it. Subsequent adds redistribute over unlocked.
    if (rows.length === 0) {
      onChange([{ ...newRow, percentage: splitEvenly(1)[0] }]);
      return;
    }
    onChange(redistribute([...rows, newRow], lockedKeys, getRowKey, setRowPercentage));
  }

  // #8: replace the list with one row per child family member, evenly split.
  // Resets the locked-set since this is a fresh auto allocation.
  const children = members.filter((m) => m.relationship === "child");
  function splitAmongChildren() {
    if (children.length === 0) return;
    const pcts = splitEvenly(children.length);
    const newRows: BeneficiaryRow[] = children.map((child, i) => ({
      id: `tmp-${Math.random().toString(36).slice(2)}`,
      source: { kind: "family", familyMemberId: child.id },
      percentage: pcts[i],
    }));
    setLockedKeys(new Set());
    onChange(newRows);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className={fieldLabelClassName}>{tierLabel(tier)}</label>
        <span className={sumOk ? "text-xs text-green-400" : "text-xs text-amber-400"}>
          sum: {sum.toFixed(2)}%
        </span>
      </div>
      <ul className="mt-1 space-y-2">
        {rows.map((r, idx) => (
          <li key={r.id} className="flex items-center gap-2">
            <select
              value={rowSourceToValue(r.source)}
              onChange={(e) => update(idx, { source: valueToRowSource(e.target.value) })}
              className={rowSelectClassName + " flex-1 min-w-0"}
              aria-label={`Beneficiary ${idx + 1}`}
            >
              <option value="">— select beneficiary —</option>
              <optgroup label="Household">
                <option value="hh:client">{household.client.firstName} (client)</option>
                {household.spouse && <option value="hh:spouse">{household.spouse.firstName} (spouse)</option>}
              </optgroup>
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
              {allowEntities && entities.length > 0 && (
                <optgroup label="Entity">
                  {entities.map((e) => (
                    <option key={e.id} value={`ent:${e.id}`}>{e.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={r.percentage}
              onChange={(e) => changePercentage(idx, parseFloat(e.target.value) || 0)}
              className={rowFieldBase + " w-20 text-right"}
              aria-label={`Percent ${idx + 1}`}
            />
            <span className="text-xs text-ink-3">%</span>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="text-xs text-ink-4 hover:text-red-400"
              aria-label={`Remove beneficiary ${idx + 1}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={add} className="text-xs text-blue-400 hover:text-blue-300">
          + Add beneficiary
        </button>
        {children.length > 0 && (
          <button
            type="button"
            onClick={splitAmongChildren}
            className="text-xs text-ink-3 hover:text-ink"
            title={`Replace with ${children.length} child${children.length === 1 ? "" : "ren"}, split evenly`}
          >
            Split among children
          </button>
        )}
      </div>
    </div>
  );
}
