"use client";

import { useState } from "react";
import { ownedByEntity } from "@/engine/ownership";
import type { AccountOwner, EntityOwner } from "@/engine/ownership";
import {
  clampDiscountPct,
  discountedGiftValue,
  MAX_DISCOUNT_PCT,
} from "@/lib/gifts/apply-valuation-discount";
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

export interface PickerBusiness {
  id: string;
  name: string;
  /** Flat business valuation — powers the discount dollar preview. */
  value?: number;
  /** Current entity_owners rows on the business. Mixed family + entity owners. */
  owners: EntityOwner[];
}

interface AssetPickerModalProps {
  entityId: string;
  accounts: PickerAccount[];
  liabilities: PickerLiability[];
  businesses?: PickerBusiness[];
  onClose: () => void;
  onAdd: (op: {
    type: "add";
    assetType: "account" | "liability" | "entity";
    assetId: string;
    percent: number;
    /** Fraction 0-1. Emitted only for the business-entity branch. */
    valuationDiscount?: number;
  }) => void;
  /** Most-recent discount per source, keyed `entity:<id>`. Seeds the field only. */
  priorDiscounts?: Record<string, number>;
  /** Singular noun for user-facing copy (e.g. "trust", "business"). Defaults to "trust". */
  entityLabel?: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function isRetirement(subType?: string): boolean {
  if (!subType) return false;
  return (RETIREMENT_SUBTYPES as readonly string[]).includes(subType);
}

function isOtherEntityDefaultChecking(account: PickerAccount, entityId: string): boolean {
  if (!account.isDefaultChecking) return false;
  const firstOwner = account.owners[0];
  if (!firstOwner) return false;
  return (
    firstOwner.kind === "entity" &&
    (firstOwner as { entityId: string }).entityId !== entityId
  );
}

function ownedByThisEntity(b: PickerBusiness, entityId: string): number {
  return b.owners
    .filter((o) => o.kind === "entity" && o.entityId === entityId)
    .reduce((s, o) => s + o.percent, 0);
}

type AssetType = "account" | "liability" | "entity";

interface PickedItem {
  id: string;
  name: string;
  assetType: AssetType;
  isRetirement: boolean;
  /** Flat valuation, present only for a business entity. */
  value?: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AssetPickerModal({
  entityId,
  accounts,
  liabilities,
  businesses,
  priorDiscounts,
  onClose,
  onAdd,
  entityLabel = "trust",
}: AssetPickerModalProps) {
  const [step, setStep] = useState<"pick" | "percent">("pick");
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [pctStr, setPctStr] = useState("100");
  const [discountStr, setDiscountStr] = useState("");
  const titleNoun = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);

  // Filter accounts
  const availableAccounts = accounts.filter((a) => {
    // Hide if already 100% owned by this entity
    if (Math.abs(ownedByEntity(a, entityId) - 1) < 0.0001) return false;
    // Hide other-entity default-checking accounts
    if (isOtherEntityDefaultChecking(a, entityId)) return false;
    return true;
  });

  // Filter liabilities (no special filter rules beyond the 100% check)
  const availableLiabilities = liabilities.filter((l) => {
    return Math.abs(ownedByEntity(l, entityId) - 1) >= 0.0001;
  });

  // Filter businesses (hide if already 100% owned by this entity)
  const availableBusinesses = (businesses ?? []).filter((b) => {
    return Math.abs(ownedByThisEntity(b, entityId) - 1) >= 0.0001;
  });

  function selectItem(item: PickedItem) {
    setPicked(item);
    setPctStr(item.isRetirement ? "100" : "100");
    // Prefill from the most recent discount used for this same business — an
    // initial value only. The value written on the gift row is always this
    // transfer's own; editing an earlier gift never reaches back here. The seed
    // goes through the same clamp as typed input: the column accepts a wider
    // range than the field does, and a seed the save guard would refuse would
    // show a discount this form cannot store.
    const prior =
      item.assetType === "entity" ? priorDiscounts?.[`entity:${item.id}`] : undefined;
    setDiscountStr(
      prior != null ? clampDiscountPct(String(Math.round(prior * 10_000) / 100)) : "",
    );
    setStep("percent");
  }

  const discountNum = Number(discountStr);
  // `discountStr` is clamped on entry, so the upper test is belt-and-braces —
  // it keeps a $0 gift unreachable if that clamp is ever loosened.
  const discountFraction =
    picked?.assetType === "entity" &&
    discountStr !== "" &&
    Number.isFinite(discountNum) &&
    discountNum > 0 &&
    discountNum <= MAX_DISCOUNT_PCT
      ? discountNum / 100
      : undefined;

  function handleAdd() {
    if (!picked) return;
    const pct = parseFloat(pctStr);
    if (Number.isNaN(pct) || pct <= 0 || pct > 100) return;
    onAdd({
      type: "add",
      assetType: picked.assetType,
      assetId: picked.id,
      percent: pct,
      // Omitted entirely (not null) when absent, so the op shape is unchanged
      // for the account and liability branches.
      ...(discountFraction != null ? { valuationDiscount: discountFraction } : {}),
    });
  }

  return (
    <DialogShell
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={step === "pick" ? `Add Asset to ${titleNoun}` : "Set Ownership Percent"}
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
          {availableAccounts.length === 0
            && availableLiabilities.length === 0
            && availableBusinesses.length === 0 && (
            <p className="text-[13px] text-ink-3 text-center py-4">
              All household assets are already fully assigned to this {entityLabel}.
            </p>
          )}

          {availableAccounts.length > 0 && (
            <div>
              <label className={fieldLabelClassName}>Accounts</label>
              <ul className="space-y-1">
                {availableAccounts.map((a) => {
                  const currentPct = ownedByEntity(a, entityId);
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
                  const currentPct = ownedByEntity(l, entityId);
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

          {availableBusinesses.length > 0 && (
            <div>
              <label className={fieldLabelClassName}>Business Entities</label>
              <ul className="space-y-1">
                {availableBusinesses.map((b) => {
                  const currentPct = ownedByThisEntity(b, entityId);
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() =>
                          selectItem({
                            id: b.id,
                            name: b.name,
                            assetType: "entity",
                            isRetirement: false,
                            value: b.value,
                          })
                        }
                        className="w-full flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-left hover:border-accent hover:bg-card-hover transition-colors"
                        aria-label={`Select ${b.name}`}
                      >
                        <span className="text-[13px] text-ink">{b.name}</span>
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
                ownership to the {entityLabel}.
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

          {picked?.assetType === "entity" && !picked?.isRetirement && (
            <div>
              <label className={fieldLabelClassName} htmlFor="asset-picker-discount">
                Valuation discount (optional)
              </label>
              <PercentInput
                id="asset-picker-discount"
                value={discountStr}
                onChange={(v) => setDiscountStr(clampDiscountPct(v))}
                decimals={2}
                placeholder="e.g. 30"
              />
              {(() => {
                const pct = parseFloat(pctStr);
                const full =
                  picked.value != null && Number.isFinite(pct) ? picked.value * (pct / 100) : 0;
                if (discountFraction == null || full <= 0) return null;
                return (
                  <p className="mt-1.5 text-[12px] text-ink-3" data-testid="picker-discount-preview">
                    ${Math.round(full).toLocaleString()} interest · {discountStr}% discount ·{" "}
                    <span className="font-medium text-ink-2">
                      ${Math.round(discountedGiftValue(full, discountFraction)).toLocaleString()}
                    </span>{" "}
                    uses exemption
                  </p>
                );
              })()}
              <p className="mt-1 text-[11px] text-ink-4">
                Lack of marketability / lack of control, from the appraisal. The
                {" "}{entityLabel} still receives the full interest — only the
                transfer-tax value is reduced.
              </p>
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}
