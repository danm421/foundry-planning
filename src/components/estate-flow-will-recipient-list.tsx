"use client";

import { useState } from "react";
import {
  fieldLabelClassName,
  inputBaseClassName,
  selectBaseClassName,
} from "@/components/forms/input-styles";
import { redistribute, splitEvenly } from "@/components/forms/auto-split-percentages";

/** Editable row for a will bequest's recipients (and the spouse cascade). */
export interface WillRecipientRow {
  key: string;
  recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

interface RecipientOption {
  id: string;
  label: string;
}

interface WillRecipientListProps {
  label: string;
  /** Stable id wiring the percent inputs to the sum message for a11y. */
  sumMsgId: string;
  rows: WillRecipientRow[];
  onChange: (rows: WillRecipientRow[]) => void;
  spouseName: string | null;
  familyMembers: RecipientOption[];
  externalBeneficiaries: RecipientOption[];
  entities: RecipientOption[];
  /** Family members offered by the "Split among children" shortcut. */
  childMembers: { id: string }[];
  /** aria-label applied to each recipient <select>. */
  recipientAriaLabel: string;
}

let _rowKeyCounter = 0;
function newRowKey(): string {
  return `wr-${++_rowKeyCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Number.isNaN(v) ? 0 : v));
}

function rowToSelectValue(row: WillRecipientRow): string {
  if (row.recipientKind === "spouse") return "spouse";
  if (row.recipientKind === "entity") return `ent:${row.recipientId ?? ""}`;
  if (row.recipientKind === "external_beneficiary") return `ext:${row.recipientId ?? ""}`;
  if (row.recipientKind === "family_member") return `fm:${row.recipientId ?? ""}`;
  return "";
}

function selectValueToPatch(
  value: string,
): Pick<WillRecipientRow, "recipientKind" | "recipientId"> {
  if (value === "spouse") return { recipientKind: "spouse", recipientId: null };
  if (value.startsWith("fm:")) return { recipientKind: "family_member", recipientId: value.slice(3) };
  if (value.startsWith("ext:")) return { recipientKind: "external_beneficiary", recipientId: value.slice(4) };
  if (value.startsWith("ent:")) return { recipientKind: "entity", recipientId: value.slice(4) };
  return { recipientKind: "family_member", recipientId: null };
}

const getKey = (r: WillRecipientRow): string => r.key;
const setPct = (r: WillRecipientRow, percentage: number): WillRecipientRow => ({
  ...r,
  percentage,
});

/**
 * A flat recipient list with the shared auto-split UX: the first add seeds
 * 100%, later adds split the remainder evenly, editing a percentage pins that
 * row while the rest rebalance, and "Split among children" replaces the list
 * with one evenly-split row per child. Controlled — the parent owns `rows`.
 */
export default function WillRecipientList({
  label,
  sumMsgId,
  rows,
  onChange,
  spouseName,
  familyMembers,
  externalBeneficiaries,
  entities,
  childMembers,
  recipientAriaLabel,
}: WillRecipientListProps) {
  // Rows the advisor has manually edited — their percentages are pinned while
  // the rest rebalance. Rows seeded from props start unlocked.
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const sum = rows.reduce((s, r) => s + (Number.isFinite(r.percentage) ? r.percentage : 0), 0);
  const sumOk = rows.length === 0 || Math.abs(sum - 100) <= 0.5;

  function changePercentage(key: string, raw: number) {
    const nextLocked = new Set(lockedKeys);
    nextLocked.add(key);
    setLockedKeys(nextLocked);
    const updated = rows.map((r) => (r.key === key ? setPct(r, clampPct(raw)) : r));
    onChange(redistribute(updated, nextLocked, getKey, setPct));
  }

  function remove(key: string) {
    const nextLocked = new Set(lockedKeys);
    nextLocked.delete(key);
    setLockedKeys(nextLocked);
    onChange(redistribute(rows.filter((r) => r.key !== key), nextLocked, getKey, setPct));
  }

  function add() {
    const newRow: WillRecipientRow = {
      key: newRowKey(),
      recipientKind: spouseName ? "spouse" : "family_member",
      recipientId: null,
      percentage: 0,
      sortOrder: rows.length,
    };
    // First add seeds 100%; later adds redistribute the unlocked rows.
    if (rows.length === 0) {
      onChange([{ ...newRow, percentage: splitEvenly(1)[0] }]);
      return;
    }
    onChange(redistribute([...rows, newRow], lockedKeys, getKey, setPct));
  }

  function changeRecipient(key: string, value: string) {
    const patch = selectValueToPatch(value);
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function splitAmongChildren() {
    if (childMembers.length === 0) return;
    const pcts = splitEvenly(childMembers.length);
    setLockedKeys(new Set());
    onChange(
      childMembers.map((child, i) => ({
        key: newRowKey(),
        recipientKind: "family_member" as const,
        recipientId: child.id,
        percentage: pcts[i],
        sortOrder: i,
      })),
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className={fieldLabelClassName + " mb-0"}>{label}</span>
        <span id={sumMsgId} className={`text-[11px] ${sumOk ? "text-ink-3" : "text-crit"}`}>
          {rows.length > 0
            ? `${sum.toFixed(0)}%${!sumOk ? " — must equal 100%" : ""}`
            : "No recipients yet"}
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <select
              aria-label={recipientAriaLabel}
              value={rowToSelectValue(row)}
              onChange={(e) => changeRecipient(row.key, e.target.value)}
              className={selectBaseClassName + " flex-1 min-w-0"}
            >
              <option value="">— select recipient —</option>
              {spouseName && (
                <optgroup label="Household">
                  <option value="spouse">{spouseName} (spouse)</option>
                </optgroup>
              )}
              {familyMembers.length > 0 && (
                <optgroup label="Family">
                  {familyMembers.map((fm) => (
                    <option key={fm.id} value={`fm:${fm.id}`}>
                      {fm.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {externalBeneficiaries.length > 0 && (
                <optgroup label="External">
                  {externalBeneficiaries.map((x) => (
                    <option key={x.id} value={`ext:${x.id}`}>
                      {x.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {entities.length > 0 && (
                <optgroup label="Entity">
                  {entities.map((e) => (
                    <option key={e.id} value={`ent:${e.id}`}>
                      {e.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              aria-label={`${recipientAriaLabel} percent`}
              aria-describedby={sumMsgId}
              aria-invalid={!sumOk}
              value={row.percentage}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                changePercentage(row.key, Number.isNaN(v) ? row.percentage : v);
              }}
              className={inputBaseClassName + " w-20 text-right"}
            />
            <span className="text-[12px] text-ink-3">%</span>
            <button
              type="button"
              aria-label={`Remove ${recipientAriaLabel}`}
              onClick={() => remove(row.key)}
              className="text-[12px] text-ink-4 hover:text-crit transition-colors"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          className="text-[12px] text-accent hover:text-accent-ink"
        >
          + Add recipient
        </button>
        {childMembers.length > 0 && (
          <button
            type="button"
            onClick={splitAmongChildren}
            className="text-[12px] text-ink-3 hover:text-ink"
            title={`Replace with ${childMembers.length} child${
              childMembers.length === 1 ? "" : "ren"
            }, split evenly`}
          >
            Split among children
          </button>
        )}
      </div>
    </div>
  );
}
