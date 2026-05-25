"use client";

import { useState } from "react";
import MoneyText from "@/components/money-text";
import DialogShell from "../dialog-shell";

interface PickableAccount {
  id: string;
  name: string;
  value: number | string;
  category: string;
  parentAccountId?: string | null;
}

interface PickableLiability {
  id: string;
  name: string;
  balance: number | string;
  parentAccountId?: string | null;
}

export interface ReparentPickerDialogProps {
  open: boolean;
  onClose: () => void;
  businessName: string;
  accounts: PickableAccount[];
  liabilities: PickableLiability[];
  onPick: (target: { kind: "account" | "liability"; id: string; name: string }) => void;
}

const toNum = (v: number | string): number =>
  typeof v === "number" ? v : parseFloat(v || "0") || 0;

export default function ReparentPickerDialog({
  open,
  onClose,
  businessName,
  accounts,
  liabilities,
  onPick,
}: ReparentPickerDialogProps) {
  const [search, setSearch] = useState("");
  if (!open) return null;

  const term = search.trim().toLowerCase();
  const matchesTerm = (s: string) => !term || s.toLowerCase().includes(term);

  const eligibleAccounts = accounts.filter(
    (a) => a.parentAccountId == null && a.category !== "business" && matchesTerm(a.name),
  );
  const eligibleLiabilities = liabilities.filter(
    (l) => l.parentAccountId == null && matchesTerm(l.name),
  );

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Reassign to ${businessName}`}
      size="md"
    >
      <div className="space-y-4">
        <input
          type="text"
          autoFocus
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 h-9 text-[13px] text-ink"
        />

        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-4 mb-1">Accounts</p>
          {eligibleAccounts.length === 0 ? (
            <p className="text-[12px] text-ink-4 py-2">No standalone accounts available.</p>
          ) : (
            <ul className="space-y-1">
              {eligibleAccounts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ kind: "account", id: a.id, name: a.name })}
                    className="w-full flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 hover:bg-card-hover text-left"
                  >
                    <span className="flex-1 text-[13px] text-ink truncate">{a.name}</span>
                    <span className="text-[11px] uppercase tracking-wider text-ink-4">{a.category}</span>
                    <span className="text-[12px] tabular-nums text-ink-2"><MoneyText value={toNum(a.value)} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-4 mb-1">Liabilities</p>
          {eligibleLiabilities.length === 0 ? (
            <p className="text-[12px] text-ink-4 py-2">No standalone liabilities available.</p>
          ) : (
            <ul className="space-y-1">
              {eligibleLiabilities.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ kind: "liability", id: l.id, name: l.name })}
                    className="w-full flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 hover:bg-card-hover text-left"
                  >
                    <span className="flex-1 text-[13px] text-ink truncate">{l.name}</span>
                    <span className="text-[12px] tabular-nums text-crit">
                      (<MoneyText value={toNum(l.balance)} />)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
