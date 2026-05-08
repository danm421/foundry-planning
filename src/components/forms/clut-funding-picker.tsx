"use client";

import { useEffect, useRef, useState } from "react";
import type { ClutFundingPick } from "@/lib/forms/clut-funding-diff";
import { inputBaseClassName } from "./input-styles";
import { formatCompact } from "@/lib/format-compact";

export interface ClutFundingPickerAccount {
  id: string;
  name: string;
  subType?: string;
  ownerSummary: string;
  value: number;
}

interface ClutFundingPickerProps {
  accounts: ClutFundingPickerAccount[];
  picks: ClutFundingPick[];
  inceptionValue: number;
  defaultGrantor: "client" | "spouse";
  onChange: (next: ClutFundingPick[]) => void;
}

const MONEY_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function summary(picks: ClutFundingPick[], inceptionValue: number): string {
  const count = picks.length;
  if (count === 0) return "Select assets to fund the trust";
  const noun = count === 1 ? "row" : "rows";
  return `${count} ${noun} · ${formatCompact(inceptionValue)}`;
}

function findAssetPick(picks: ClutFundingPick[], accountId: string) {
  return picks.find((p) => p.kind === "asset" && p.accountId === accountId) as
    | (ClutFundingPick & { kind: "asset" })
    | undefined;
}

function findCashPick(picks: ClutFundingPick[]) {
  return picks.find((p) => p.kind === "cash") as
    | (ClutFundingPick & { kind: "cash" })
    | undefined;
}

export default function ClutFundingPicker({
  accounts,
  picks,
  inceptionValue,
  defaultGrantor,
  onChange,
}: ClutFundingPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const cashPick = findCashPick(picks);

  function toggleAsset(account: ClutFundingPickerAccount) {
    const existing = findAssetPick(picks, account.id);
    if (existing) {
      onChange(picks.filter((p) => p !== existing));
    } else {
      onChange([
        ...picks,
        { kind: "asset", accountId: account.id, percent: 1.0 },
      ]);
    }
  }

  function setAssetPercent(accountId: string, pctNumber: number) {
    const next = picks.map((p) => {
      if (p.kind === "asset" && p.accountId === accountId) {
        return { ...p, percent: Math.max(0, Math.min(1, pctNumber / 100)) };
      }
      return p;
    });
    onChange(next);
  }

  function toggleCash() {
    if (cashPick) {
      onChange(picks.filter((p) => p !== cashPick));
    } else {
      onChange([
        ...picks,
        { kind: "cash", grantor: defaultGrantor, amount: 0 },
      ]);
    }
  }

  function setCashAmount(amount: number) {
    onChange(
      picks.map((p) =>
        p.kind === "cash" ? { ...p, amount: Math.max(0, amount) } : p,
      ),
    );
  }

  function setCashGrantor(g: "client" | "spouse") {
    onChange(
      picks.map((p) => (p.kind === "cash" ? { ...p, grantor: g } : p)),
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${inputBaseClassName} w-full flex items-center justify-between text-left`}
      >
        <span className={picks.length === 0 ? "text-ink-4" : "text-ink"}>
          {summary(picks, inceptionValue)}
        </span>
        <span aria-hidden className="text-ink-3">▾</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="CLUT funding picker"
          className="absolute left-0 right-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-[var(--radius-sm)] border border-hair bg-card shadow-lg"
        >
          {accounts.length === 0 && (
            <div className="px-3 py-3 text-xs text-ink-3 italic">
              No eligible accounts to transfer.
            </div>
          )}
          {accounts.map((acct) => {
            const picked = findAssetPick(picks, acct.id);
            const pct = picked?.percent ?? 1.0;
            const lineValue = acct.value * pct;
            return (
              <label
                key={acct.id}
                className="flex items-center gap-3 px-3 py-2 text-[13px] text-ink hover:bg-card-hover cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!!picked}
                  onChange={() => toggleAsset(acct)}
                  className="h-4 w-4"
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{acct.name}</span>
                  <span className="block text-[11px] text-ink-3 truncate">
                    {acct.subType ? `${acct.subType} · ` : ""}{acct.ownerSummary}
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!picked}
                  value={Math.round(pct * 100)}
                  onChange={(e) =>
                    setAssetPercent(acct.id, Number(e.target.value))
                  }
                  aria-label={`Percent of ${acct.name}`}
                  className="w-16 h-7 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-2 text-[12px] text-right disabled:opacity-40"
                />
                <span className="text-[11px] text-ink-3 w-20 text-right tabular-nums">
                  {formatCompact(lineValue)}
                </span>
              </label>
            );
          })}

          {/* Cash row */}
          <label className="flex items-center gap-3 px-3 py-2 text-[13px] text-ink hover:bg-card-hover cursor-pointer border-t border-hair">
            <input
              type="checkbox"
              checked={!!cashPick}
              onChange={toggleCash}
              className="h-4 w-4"
            />
            <span className="flex-1">Cash gift</span>
            <select
              disabled={!cashPick}
              value={cashPick?.grantor ?? defaultGrantor}
              onChange={(e) =>
                setCashGrantor(e.target.value as "client" | "spouse")
              }
              aria-label="Cash gift grantor"
              className="h-7 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-2 text-[12px] disabled:opacity-40"
            >
              <option value="client">Client</option>
              <option value="spouse">Spouse</option>
            </select>
            <input
              type="number"
              min={0}
              step={1000}
              disabled={!cashPick}
              value={cashPick?.amount ?? 0}
              onChange={(e) => setCashAmount(Number(e.target.value))}
              aria-label="Cash gift amount"
              className="w-28 h-7 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-2 text-[12px] text-right disabled:opacity-40"
            />
          </label>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-hair px-3 py-2 text-[12px]">
            <span className="text-ink-3">Total</span>
            <span className="font-mono text-ink">
              {MONEY_FMT.format(inceptionValue)}
            </span>
          </div>
          <div className="flex justify-end px-3 pb-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="text-[12px] text-accent hover:text-accent-deep font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
