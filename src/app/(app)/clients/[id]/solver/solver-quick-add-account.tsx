"use client";

import { useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import {
  buildQuickAddAccount,
  defaultAccountName,
  QUICK_ADD_TYPE_MAP,
  type QuickAddType,
} from "@/lib/solver/quick-add-account";

interface OwnerOption {
  familyMemberId: string;
  label: string;
}

interface Props {
  owners: OwnerOption[];
  currentYear: number;
  /** Retirement year for a given owner (for the default End). */
  retirementYearForOwner: (familyMemberId: string) => number;
  /** CMA-resolved growth rate for the chosen type. */
  growthForType: (type: QuickAddType) => number;
  onChange: (m: SolverMutation) => void;
}

const TYPE_ORDER: QuickAddType[] = ["taxable", "ira", "roth_ira", "cash"];

export function SolverQuickAddAccount({
  owners, currentYear, retirementYearForOwner, growthForType, onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<QuickAddType>("taxable");
  const [ownerId, setOwnerId] = useState(owners[0]?.familyMemberId ?? "");
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [amount, setAmount] = useState("");

  const ownerLabel = owners.find((o) => o.familyMemberId === ownerId)?.label ?? "";
  const composedName = defaultAccountName(ownerLabel, type);
  const nameValue = nameDirty ? name : composedName;

  function reset() {
    setType("taxable"); setOwnerId(owners[0]?.familyMemberId ?? "");
    setName(""); setNameDirty(false); setAmount("");
  }

  function submit() {
    const { account, rule } = buildQuickAddAccount({
      type,
      ownerFamilyMemberId: ownerId,
      ownerLabel,
      name: nameValue,
      annualAmount: Number(amount) || 0,
      startYear: currentYear,
      endYear: retirementYearForOwner(ownerId),
      growthRate: growthForType(type),
      accountId: crypto.randomUUID(),
      ruleId: crypto.randomUUID(),
    });
    onChange({ kind: "account-upsert", id: account.id, value: account });
    onChange({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        + Add account
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-hair-2 bg-card-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[12px] text-ink-3">
          Type
          <select
            aria-label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as QuickAddType)}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          >
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{QUICK_ADD_TYPE_MAP[t].label}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-ink-3">
          Owner
          <select
            aria-label="Owner"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          >
            {owners.map((o) => (
              <option key={o.familyMemberId} value={o.familyMemberId}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-[12px] text-ink-3">
          Name
          <input
            aria-label="Name"
            value={nameValue}
            onChange={(e) => { setNameDirty(true); setName(e.target.value); }}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
        <label className="col-span-2 text-[12px] text-ink-3">
          Annual savings
          <input
            aria-label="Annual savings"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-ink-4">
        Starts {currentYear}, ends at retirement ({retirementYearForOwner(ownerId)}).
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="px-3 py-1 text-[12px] text-ink-3">
          Cancel
        </button>
        <button type="button" onClick={submit} className="rounded bg-accent/20 px-3 py-1 text-[12px] font-medium text-ink">
          Add
        </button>
      </div>
    </div>
  );
}
