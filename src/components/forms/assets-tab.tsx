"use client";

import { useState } from "react";
import { ownedByEntity } from "@/engine/ownership";
import type { AccountOwner } from "@/engine/ownership";
import type { AssetTabOp } from "./asset-tab-ops";
import AssetPickerModal from "./asset-picker-modal";
import MoneyText from "@/components/money-text";
import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName } from "./input-styles";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssetsTabAccount {
  id: string;
  name: string;
  value: number;
  subType?: string;
  isDefaultChecking?: boolean;
  owners: AccountOwner[];
}

export interface AssetsTabLiability {
  id: string;
  name: string;
  balance: number;
  owners: AccountOwner[];
}

export interface AssetsTabIncome {
  id: string;
  name: string;
  annualAmount: number;
  cashAccountId?: string;
}

export interface AssetsTabExpense {
  id: string;
  name: string;
  annualAmount: number;
  cashAccountId?: string;
}

export interface AssetsTabFamilyMember {
  id: string;
  role: "client" | "spouse" | "child" | "other";
  firstName: string;
}

interface AssetsTabProps {
  entityId: string;
  accounts: AssetsTabAccount[];
  liabilities: AssetsTabLiability[];
  incomes: AssetsTabIncome[];
  expenses: AssetsTabExpense[];
  familyMembers: AssetsTabFamilyMember[];
  entities: { id: string; name: string }[];
  onChange: (op: AssetTabOp) => void;
  /** Singular noun for user-facing copy (e.g. "trust", "business"). Defaults to "trust". */
  entityLabel?: string;
}

// ── RemoveConfirmation (inline, no extra dep) ─────────────────────────────────

interface RemoveConfirmProps {
  name: string;
  entityLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function RemoveConfirm({ name, entityLabel, onConfirm, onCancel }: RemoveConfirmProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-paper/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-[400px] rounded-[var(--radius)] border-2 border-ink-3 ring-1 ring-black/60 bg-card p-6 shadow-2xl">
        <p className="text-[14px] text-ink-2">
          Remove <strong className="text-ink">{name}</strong> from this {entityLabel}?
          <span className="mt-1 block text-[12px] text-ink-4">
            The freed ownership will be redistributed to household members.
          </span>
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] border border-transparent px-4 h-9 text-[13px] font-medium text-ink-2 hover:text-ink hover:bg-card-hover hover:border-hair"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[var(--radius-sm)] px-4 h-9 text-[13px] font-medium text-crit hover:bg-card-hover"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AssetRow ──────────────────────────────────────────────────────────────────

interface AssetRowProps {
  name: string;
  proRatedValue: number; // positive for asset, negative for liability
  ownerPct: number; // 0-1
  entityLabel: string;
  onRemove: () => void;
  onPctChange: (pct: number) => void;
}

const EPSILON = 0.0001;

function AssetRow({ name, proRatedValue, ownerPct, entityLabel, onRemove, onPctChange }: AssetRowProps) {
  const [pctStr, setPctStr] = useState(() => (ownerPct * 100).toFixed(0));
  const isNeg = proRatedValue < 0;

  // C4: commit on blur or Enter — not on every keystroke — to avoid per-character PUTs.
  function handlePctChange(raw: string) {
    setPctStr(raw); // local display only; no fetch until commit
  }

  function handlePctCommit() {
    const val = parseFloat(pctStr);
    if (!Number.isNaN(val) && val >= 0 && val <= 100) {
      const fraction = val / 100;
      if (Math.abs(fraction - ownerPct) > EPSILON) {
        onPctChange(val);
      }
    } else {
      setPctStr((ownerPct * 100).toFixed(0)); // revert to canonical
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
      <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{name}</span>
      <span className={`text-[12px] tabular ${isNeg ? "text-crit" : "text-ink-2"}`}>
        <MoneyText value={proRatedValue} />
      </span>
      <span className="inline-flex items-center gap-1">
        <div className="w-20">
          <PercentInput
            value={pctStr}
            onChange={handlePctChange}
            onBlur={handlePctCommit}
            onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && handlePctCommit()}
            decimals={0}
            aria-label={`Ownership percent for ${name}`}
          />
        </div>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-ink-4 hover:text-crit text-[13px] ml-1"
        aria-label={`Remove ${name} from ${entityLabel}`}
      >
        ✕
      </button>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AssetsTab({
  entityId,
  accounts,
  liabilities,
  incomes,
  expenses,
  onChange,
  entityLabel = "trust",
}: AssetsTabProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removingItem, setRemovingItem] = useState<{
    kind: "account" | "liability";
    id: string;
    name: string;
  } | null>(null);

  // Filter to entity-owned items
  const ownedAccounts = accounts.filter((a) => ownedByEntity(a, entityId) > 0);
  const ownedLiabilities = liabilities.filter((l) => ownedByEntity(l, entityId) > 0);

  // Entity-asset id set for income/expense lookup
  const entityAssetIds = new Set(ownedAccounts.map((a) => a.id));

  const linkedIncomes = incomes.filter((i) => i.cashAccountId && entityAssetIds.has(i.cashAccountId));
  const linkedExpenses = expenses.filter((e) => e.cashAccountId && entityAssetIds.has(e.cashAccountId));

  // Total entity value
  const totalValue =
    ownedAccounts.reduce((s, a) => s + a.value * ownedByEntity(a, entityId), 0) -
    ownedLiabilities.reduce((s, l) => s + l.balance * ownedByEntity(l, entityId), 0);

  const isEmpty = ownedAccounts.length === 0 && ownedLiabilities.length === 0;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
        <span className="text-[12px] font-medium text-ink-3 uppercase tracking-wider">
          Net {entityLabel} value
        </span>
        <MoneyText value={totalValue} className="text-[15px] font-semibold text-ink" />
      </div>

      {/* Accounts */}
      <div>
        <label className={fieldLabelClassName}>Accounts</label>
        {ownedAccounts.length === 0 ? (
          <p className="text-[12px] text-ink-4 py-2">No accounts owned by this {entityLabel}.</p>
        ) : (
          <ul className="space-y-1.5">
            {ownedAccounts.map((a) => {
              const ownerPct = ownedByEntity(a, entityId);
              return (
                <AssetRow
                  key={a.id}
                  name={a.name}
                  proRatedValue={a.value * ownerPct}
                  ownerPct={ownerPct}
                  entityLabel={entityLabel}
                  onRemove={() => setRemovingItem({ kind: "account", id: a.id, name: a.name })}
                  onPctChange={(pct) =>
                    onChange({ type: "set-percent", assetType: "account", assetId: a.id, percent: pct })
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* Liabilities */}
      <div>
        <label className={fieldLabelClassName}>Liabilities</label>
        {ownedLiabilities.length === 0 ? (
          <p className="text-[12px] text-ink-4 py-2">No liabilities owned by this {entityLabel}.</p>
        ) : (
          <ul className="space-y-1.5">
            {ownedLiabilities.map((l) => {
              const ownerPct = ownedByEntity(l, entityId);
              return (
                <AssetRow
                  key={l.id}
                  name={l.name}
                  proRatedValue={-(l.balance * ownerPct)}
                  ownerPct={ownerPct}
                  entityLabel={entityLabel}
                  onRemove={() => setRemovingItem({ kind: "liability", id: l.id, name: l.name })}
                  onPctChange={(pct) =>
                    onChange({ type: "set-percent", assetType: "liability", assetId: l.id, percent: pct })
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* Add button */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="text-[12px] text-accent hover:text-accent-deep font-medium"
      >
        + Add asset
      </button>

      {/* Read-only income/expense panel */}
      {(linkedIncomes.length > 0 || linkedExpenses.length > 0) && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Linked cash flows <span className="ml-1 normal-case font-normal text-ink-4">(read-only)</span>
          </p>
          {linkedIncomes.map((i) => (
            <div key={i.id} className="flex items-center justify-between">
              <span className="text-[12px] text-ink-2">{i.name}</span>
              <span className="text-[12px] text-ink-2 tabular">
                <MoneyText value={i.annualAmount} /> / yr
              </span>
            </div>
          ))}
          {linkedExpenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between">
              <span className="text-[12px] text-ink-2">{e.name}</span>
              <span className="text-[12px] text-crit tabular">
                (<MoneyText value={e.annualAmount} />) / yr
              </span>
            </div>
          ))}
        </div>
      )}

      {isEmpty && (
        <p className="text-[12px] text-ink-4 text-center py-4">
          No assets assigned to this {entityLabel}. Use &quot;+ Add asset&quot; to assign accounts or liabilities.
        </p>
      )}

      {/* Asset picker modal */}
      {pickerOpen && (
        <AssetPickerModal
          entityId={entityId}
          accounts={accounts}
          liabilities={liabilities}
          entityLabel={entityLabel}
          onClose={() => setPickerOpen(false)}
          onAdd={(op) => {
            onChange(op);
            setPickerOpen(false);
          }}
        />
      )}

      {/* Remove confirmation */}
      {removingItem && (
        <RemoveConfirm
          name={removingItem.name}
          entityLabel={entityLabel}
          onConfirm={() => {
            onChange({
              type: "remove",
              assetType: removingItem.kind,
              assetId: removingItem.id,
            });
            setRemovingItem(null);
          }}
          onCancel={() => setRemovingItem(null)}
        />
      )}
    </div>
  );
}
