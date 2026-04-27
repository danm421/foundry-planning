"use client";

import { useState } from "react";
import { ownedByEntity } from "@/engine/ownership";
import type { AccountOwner } from "@/engine/ownership";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";
import DialogShell from "@/components/dialog-shell";
import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName } from "./input-styles";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PickerAccount {
  id: string;
  name: string;
  subType?: string;
  isDefaultChecking?: boolean;
  owners: AccountOwner[];
}

export interface PickerLiability {
  id: string;
  name: string;
  owners: AccountOwner[];
}

interface AssetPickerModalProps {
  trustId: string;
  accounts: PickerAccount[];
  liabilities: PickerLiability[];
  onClose: () => void;
  onAdd: (op: { type: "add"; assetType: "account" | "liability"; assetId: string; percent: number }) => void;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function isRetirement(subType?: string): boolean {
  if (!subType) return false;
  return (RETIREMENT_SUBTYPES as readonly string[]).includes(subType);
}

function isOtherEntityDefaultChecking(account: PickerAccount, trustId: string): boolean {
  if (!account.isDefaultChecking) return false;
  const firstOwner = account.owners[0];
  if (!firstOwner) return false;
  return (
    firstOwner.kind === "entity" &&
    (firstOwner as { entityId: string }).entityId !== trustId
  );
}

type AssetType = "account" | "liability";

interface PickedItem {
  id: string;
  name: string;
  assetType: AssetType;
  isRetirement: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AssetPickerModal({
  trustId,
  accounts,
  liabilities,
  onClose,
  onAdd,
}: AssetPickerModalProps) {
  const [step, setStep] = useState<"pick" | "percent">("pick");
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [pctStr, setPctStr] = useState("100");

  // Filter accounts
  const availableAccounts = accounts.filter((a) => {
    // Hide if already 100% owned by this trust
    if (Math.abs(ownedByEntity(a, trustId) - 1) < 0.0001) return false;
    // Hide other-entity default-checking accounts
    if (isOtherEntityDefaultChecking(a, trustId)) return false;
    return true;
  });

  // Filter liabilities (no special filter rules beyond the 100% check)
  const availableLiabilities = liabilities.filter((l) => {
    return Math.abs(ownedByEntity(l, trustId) - 1) >= 0.0001;
  });

  function selectItem(item: PickedItem) {
    setPicked(item);
    setPctStr(item.isRetirement ? "100" : "100");
    setStep("percent");
  }

  function handleAdd() {
    if (!picked) return;
    const pct = parseFloat(pctStr);
    if (Number.isNaN(pct) || pct <= 0 || pct > 100) return;
    onAdd({ type: "add", assetType: picked.assetType, assetId: picked.id, percent: pct });
  }

  return (
    <DialogShell
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={step === "pick" ? "Add Asset to Trust" : "Set Ownership Percent"}
      size="sm"
      primaryAction={
        step === "pick"
          ? undefined
          : picked?.isRetirement
          ? { label: "Reassign 100%", onClick: handleAdd }
          : { label: "Add", onClick: handleAdd, disabled: !picked }
      }
      secondaryAction={
        step === "pick"
          ? { label: "Cancel", onClick: onClose }
          : { label: "Back", onClick: () => setStep("pick") }
      }
    >
      {step === "pick" ? (
        <div className="space-y-4">
          {availableAccounts.length === 0 && availableLiabilities.length === 0 && (
            <p className="text-[13px] text-ink-3 text-center py-4">
              All household assets are already fully assigned to this trust.
            </p>
          )}

          {availableAccounts.length > 0 && (
            <div>
              <label className={fieldLabelClassName}>Accounts</label>
              <ul className="space-y-1">
                {availableAccounts.map((a) => {
                  const currentPct = ownedByEntity(a, trustId);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() =>
                          selectItem({
                            id: a.id,
                            name: a.name,
                            assetType: "account",
                            isRetirement: isRetirement(a.subType),
                          })
                        }
                        className="w-full flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-left hover:border-accent hover:bg-card-hover transition-colors"
                        aria-label={`Select ${a.name}`}
                      >
                        <span className="text-[13px] text-ink">{a.name}</span>
                        <span className="text-[11px] text-ink-4">
                          {currentPct > 0 ? `${(currentPct * 100).toFixed(0)}% owned` : "unassigned"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {availableLiabilities.length > 0 && (
            <div>
              <label className={fieldLabelClassName}>Liabilities</label>
              <ul className="space-y-1">
                {availableLiabilities.map((l) => {
                  const currentPct = ownedByEntity(l, trustId);
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() =>
                          selectItem({
                            id: l.id,
                            name: l.name,
                            assetType: "liability",
                            isRetirement: false,
                          })
                        }
                        className="w-full flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-left hover:border-accent hover:bg-card-hover transition-colors"
                        aria-label={`Select ${l.name}`}
                      >
                        <span className="text-[13px] text-ink">{l.name}</span>
                        <span className="text-[11px] text-ink-4">
                          {currentPct > 0 ? `${(currentPct * 100).toFixed(0)}% owned` : "unassigned"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">
            Adding: <strong className="text-ink">{picked?.name}</strong>
          </p>

          {picked?.isRetirement ? (
            <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3">
              <p className="text-[12px] text-ink-3">
                Retirement accounts require a single owner at 100%. This will reassign full
                ownership to the trust.
              </p>
            </div>
          ) : (
            <div>
              <label className={fieldLabelClassName} htmlFor="asset-picker-pct">
                Ownership percent
              </label>
              <PercentInput
                id="asset-picker-pct"
                value={pctStr}
                onChange={setPctStr}
                decimals={0}
                placeholder="100"
              />
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}
